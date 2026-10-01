import { randomUUID } from "node:crypto";
import { AppError, col, now, transaction, type Store } from "./db.js";

type Point = { lat: number; lng: number; label: string };
type PassengerLocationInput = {
  lat: number;
  lng: number;
  accuracy?: number;
  speedKph?: number;
  heading?: number;
};

const FRESH_PASSENGER_MS = 2 * 60 * 1000;
const STALE_PASSENGER_MS = 10 * 60 * 1000;
const SHARE_BEFORE_MS = 2 * 60 * 60 * 1000;
const SHARE_AFTER_MS = 2 * 60 * 60 * 1000;

export const cityCoordinates: Record<string, Point> = {
  Bengaluru: { lat: 12.9716, lng: 77.5946, label: "Bengaluru" },
  Chennai: { lat: 13.0827, lng: 80.2707, label: "Chennai" },
  Hyderabad: { lat: 17.385, lng: 78.4867, label: "Hyderabad" },
  Mumbai: { lat: 19.076, lng: 72.8777, label: "Mumbai" },
  Pune: { lat: 18.5204, lng: 73.8567, label: "Pune" },
  Goa: { lat: 15.4909, lng: 73.8278, label: "Goa" },
  Madurai: { lat: 9.9252, lng: 78.1198, label: "Madurai" },
  Coimbatore: { lat: 11.0168, lng: 76.9558, label: "Coimbatore" },
};

const clamp = (value: number) => Math.max(0, Math.min(1, value));

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function coordinatesForTrip(trip: any) {
  const origin =
    trip.originLocation?.lat != null && trip.originLocation?.lng != null
      ? {
          lat: Number(trip.originLocation.lat),
          lng: Number(trip.originLocation.lng),
          label: trip.originLocation.label ?? trip.from,
        }
      : cityCoordinates[trip.from];
  const destination =
    trip.destinationLocation?.lat != null && trip.destinationLocation?.lng != null
      ? {
          lat: Number(trip.destinationLocation.lat),
          lng: Number(trip.destinationLocation.lng),
          label: trip.destinationLocation.label ?? trip.to,
        }
      : cityCoordinates[trip.to];
  return { origin, destination };
}

function routeProgress(location: any, origin?: Point, destination?: Point) {
  if (!location || !origin || !destination) return null;
  const dx = destination.lng - origin.lng;
  const dy = destination.lat - origin.lat;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return 1;
  return clamp(
    ((location.lng - origin.lng) * dx + (location.lat - origin.lat) * dy) /
      lengthSquared,
  );
}

function shareWindow(trip: any, clock: Date) {
  const departure = new Date(trip.departureAt);
  const arrival = new Date(trip.arrivalAt);
  const opensAt = new Date(departure.getTime() - SHARE_BEFORE_MS);
  const closesAt = new Date(arrival.getTime() + SHARE_AFTER_MS);
  return {
    opensAt,
    closesAt,
    canShare: clock >= opensAt && clock <= closesAt,
  };
}

async function recomputePassengerAggregate(
  s: Store,
  tripId: string,
  clock: Date,
  session: any,
) {
  const cutoff = new Date(clock.getTime() - FRESH_PASSENGER_MS);
  const reports = await col(s, "passengerLocations")
    .find(
      {
        tripId,
        updatedAt: { $gte: cutoff },
        accuracy: { $lte: 1500 },
      },
      { session },
    )
    .toArray();

  if (!reports.length) {
    await col(s, "tracking").deleteOne({ _id: tripId }, { session });
    return null;
  }

  const speeds = reports
    .map((report) => Number(report.speedKph))
    .filter((value) => Number.isFinite(value) && value >= 0);
  const accuracies = reports
    .map((report) => Number(report.accuracy))
    .filter((value) => Number.isFinite(value) && value >= 0);

  const aggregate = {
    _id: tripId,
    tripId,
    lat: median(reports.map((report) => Number(report.lat))),
    lng: median(reports.map((report) => Number(report.lng))),
    accuracy: accuracies.length ? median(accuracies) : null,
    speedKph: speeds.length ? median(speeds) : null,
    heading: null,
    label: "Passenger-shared bus position",
    source: "PASSENGER_CROWD_GPS",
    contributors: reports.length,
    updatedAt: clock,
  };

  await col(s, "tracking").replaceOne({ _id: tripId }, aggregate, {
    upsert: true,
    session,
  });
  return aggregate;
}

async function publishTrackingChanged(
  s: Store,
  tripId: string,
  clock: Date,
  session: any,
) {
  await col(s, "outbox").insertOne(
    {
      _id: randomUUID(),
      kind: "TRACKING_CHANGED",
      tripId,
      createdAt: clock,
      sentAt: null,
    },
    { session },
  );
}

export async function recordPassengerLocation(
  s: Store,
  bookingId: string,
  userId: string,
  input: PassengerLocationInput,
) {
  return transaction(s, async (session) => {
    const booking = await col(s, "bookings").findOne(
      { _id: bookingId, userId, status: "CONFIRMED" },
      { session },
    );
    if (!booking)
      throw new AppError(404, "Confirmed journey not found");

    const clock = await now(s, session);
    const window = shareWindow(booking.trip, clock);
    if (!window.canShare)
      throw new AppError(
        409,
        "Passenger location sharing opens two hours before departure and closes two hours after scheduled arrival.",
        "LOCATION_SHARING_CLOSED",
      );

    const report = {
      _id: bookingId,
      bookingId,
      userId,
      tripId: booking.trip._id,
      lat: input.lat,
      lng: input.lng,
      accuracy: input.accuracy ?? 1500,
      speedKph: input.speedKph ?? null,
      heading: input.heading ?? null,
      updatedAt: clock,
    };
    await col(s, "passengerLocations").replaceOne({ _id: bookingId }, report, {
      upsert: true,
      session,
    });

    const aggregate = await recomputePassengerAggregate(
      s,
      booking.trip._id,
      clock,
      session,
    );
    await publishTrackingChanged(s, booking.trip._id, clock, session);

    return {
      ok: true,
      tripId: booking.trip._id,
      contributors: aggregate?.contributors ?? 0,
      updatedAt: clock,
    };
  });
}

export async function stopPassengerLocation(
  s: Store,
  bookingId: string,
  userId: string,
) {
  return transaction(s, async (session) => {
    const booking = await col(s, "bookings").findOne(
      { _id: bookingId, userId },
      { session },
    );
    if (!booking) throw new AppError(404, "Journey not found");
    const clock = await now(s, session);

    await col(s, "passengerLocations").deleteOne(
      { _id: bookingId, userId },
      { session },
    );
    const aggregate = await recomputePassengerAggregate(
      s,
      booking.trip._id,
      clock,
      session,
    );
    await publishTrackingChanged(s, booking.trip._id, clock, session);

    return {
      ok: true,
      contributors: aggregate?.contributors ?? 0,
    };
  });
}

export async function getTripTracking(s: Store, tripId: string) {
  const [trip, clock, live] = await Promise.all([
    col(s, "trips").findOne({ _id: tripId }),
    now(s),
    col(s, "tracking").findOne({ _id: tripId }),
  ]);
  if (!trip) throw new AppError(404, "Trip not found");

  const departure = new Date(trip.departureAt);
  const arrival = new Date(trip.arrivalAt);
  const duration = Math.max(1, arrival.getTime() - departure.getTime());
  const scheduledProgress = clamp(
    (clock.getTime() - departure.getTime()) / duration,
  );
  const phase =
    clock < departure
      ? "BEFORE_DEPARTURE"
      : clock >= arrival
        ? "ARRIVED"
        : "IN_TRANSIT";
  const { origin, destination } = coordinatesForTrip(trip);
  const liveAge = live?.updatedAt
    ? clock.getTime() - new Date(live.updatedAt).getTime()
    : Number.POSITIVE_INFINITY;
  const passengerAggregate = live?.source === "PASSENGER_CROWD_GPS";
  const liveFresh = passengerAggregate && liveAge <= FRESH_PASSENGER_MS;
  const liveStale = passengerAggregate && liveAge <= STALE_PASSENGER_MS;
  const window = shareWindow(trip, clock);

  let location: any = null;
  let source = "SCHEDULE";
  let progress: number | null = scheduledProgress;
  let contributors = 0;

  if (phase === "IN_TRANSIT" && liveFresh) {
    location = {
      lat: Number(live.lat),
      lng: Number(live.lng),
      accuracy: live.accuracy ?? null,
      speedKph: live.speedKph ?? null,
      heading: null,
      label: live.label ?? "Passenger-shared bus position",
    };
    source = "PASSENGER_LIVE_GPS";
    contributors = Number(live.contributors ?? 1);
    progress = routeProgress(location, origin, destination) ?? scheduledProgress;
  } else if (trip.demo && origin && destination) {
    location = {
      lat: origin.lat + (destination.lat - origin.lat) * scheduledProgress,
      lng: origin.lng + (destination.lng - origin.lng) * scheduledProgress,
      accuracy: null,
      speedKph: phase === "IN_TRANSIT" ? 52 : 0,
      heading: null,
      label:
        phase === "BEFORE_DEPARTURE"
          ? origin.label
          : phase === "ARRIVED"
            ? destination.label
            : "Demo bus position",
    };
    source =
      phase === "IN_TRANSIT" ? "DEMO_SIMULATION" : "SCHEDULE";
  } else if (phase === "IN_TRANSIT" && liveStale) {
    location = {
      lat: Number(live.lat),
      lng: Number(live.lng),
      accuracy: live.accuracy ?? null,
      speedKph: live.speedKph ?? null,
      heading: null,
      label: "Last passenger-shared bus position",
    };
    source = "STALE_PASSENGER_GPS";
    contributors = Number(live.contributors ?? 1);
    progress = routeProgress(location, origin, destination) ?? scheduledProgress;
  }

  return {
    tripId,
    phase,
    source,
    serverNow: clock,
    lastUpdated: live?.updatedAt ?? null,
    progress: Math.round((progress ?? 0) * 100),
    contributors,
    sharing: window,
    origin: origin ?? { label: trip.from },
    destination: destination ?? { label: trip.to },
    location,
    scheduledDeparture: departure,
    scheduledArrival: arrival,
    etaAt: arrival,
    trip: {
      _id: trip._id,
      name: trip.name,
      from: trip.from,
      to: trip.to,
      date: trip.date,
      departureAt: trip.departureAt,
      arrivalAt: trip.arrivalAt,
    },
  };
}
