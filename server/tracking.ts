import { randomUUID } from "node:crypto";
import { AppError, col, now, transaction, type Store } from "./db.js";

type Point = { lat: number; lng: number; label: string };

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
  const liveFresh =
    live?.updatedAt &&
    clock.getTime() - new Date(live.updatedAt).getTime() <= 10 * 60 * 1000;

  let location: any = null;
  let source = "SCHEDULE";
  let progress: number | null = scheduledProgress;

  if (liveFresh) {
    location = {
      lat: Number(live.lat),
      lng: Number(live.lng),
      accuracy: live.accuracy ?? null,
      speedKph: live.speedKph ?? null,
      heading: live.heading ?? null,
      label: live.label ?? "Bus GPS position",
    };
    source = "LIVE_GPS";
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
  } else if (live) {
    location = {
      lat: Number(live.lat),
      lng: Number(live.lng),
      accuracy: live.accuracy ?? null,
      speedKph: live.speedKph ?? null,
      heading: live.heading ?? null,
      label: live.label ?? "Last known bus position",
    };
    source = "STALE_GPS";
    progress = routeProgress(location, origin, destination) ?? scheduledProgress;
  }

  return {
    tripId,
    phase,
    source,
    serverNow: clock,
    lastUpdated: live?.updatedAt ?? null,
    progress: Math.round((progress ?? 0) * 100),
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

export async function recordTripLocation(
  s: Store,
  tripId: string,
  adminId: string,
  input: {
    lat: number;
    lng: number;
    accuracy?: number;
    speedKph?: number;
    heading?: number;
    label?: string;
  },
) {
  return transaction(s, async (session) => {
    const trip = await col(s, "trips").findOne({ _id: tripId }, { session });
    if (!trip) throw new AppError(404, "Trip not found");
    const time = await now(s, session);
    const tracking = {
      _id: tripId,
      tripId,
      lat: input.lat,
      lng: input.lng,
      accuracy: input.accuracy ?? null,
      speedKph: input.speedKph ?? null,
      heading: input.heading ?? null,
      label: input.label?.trim() || "Live bus GPS",
      source: "LIVE_GPS",
      updatedAt: time,
      updatedBy: adminId,
    };
    await col(s, "tracking").replaceOne({ _id: tripId }, tracking, {
      upsert: true,
      session,
    });
    await col(s, "outbox").insertOne(
      {
        _id: randomUUID(),
        kind: "TRACKING_CHANGED",
        tripId,
        createdAt: time,
        sentAt: null,
      },
      { session },
    );
    return tracking;
  });
}
