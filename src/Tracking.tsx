import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { io } from "socket.io-client";
import {
  ArrowLeft,
  BusFront,
  Clock3,
  ExternalLink,
  LocateFixed,
  MapPin,
  Navigation,
  PhoneCall,
  Radio,
  RefreshCw,
  ShieldCheck,
  StopCircle,
} from "lucide-react";
import { API, api, dateLabel, time, type SupportContact } from "./lib";
import { ErrorBox } from "./Booking";

type LocalLocation = {
  lat: number;
  lng: number;
  accuracy: number;
  speedKph: number | null;
  heading: number | null;
  updatedAt: number;
};

function phaseLabel(phase?: string) {
  if (phase === "IN_TRANSIT") return "Journey in progress";
  if (phase === "ARRIVED") return "Arrived at destination";
  return "Waiting for departure";
}

function sourceLabel(source?: string) {
  if (source === "PASSENGER_LIVE_GPS") return "Passenger live GPS";
  if (source === "STALE_PASSENGER_GPS") return "Last passenger GPS";
  if (source === "DEMO_SIMULATION") return "Demo simulated movement";
  return "Scheduled position";
}

function distanceKm(
  from: { lat: number; lng: number },
  to?: { lat?: number; lng?: number },
) {
  if (to?.lat == null || to.lng == null) return null;
  const radians = (value: number) => (value * Math.PI) / 180;
  const earthKm = 6371;
  const dLat = radians(Number(to.lat) - from.lat);
  const dLng = radians(Number(to.lng) - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(from.lat)) *
      Math.cos(radians(Number(to.lat))) *
      Math.sin(dLng / 2) ** 2;
  return earthKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function TrackingPage() {
  const { id } = useParams();
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [online, setOnline] = useState(false),
    [gpsActive, setGpsActive] = useState(false),
    [sharing, setSharing] = useState(false),
    [myLocation, setMyLocation] = useState<LocalLocation | null>(null),
    [shareMessage, setShareMessage] = useState("");

  const watchRef = useRef<number | null>(null),
    lastSentRef = useRef(0),
    sharingRef = useRef(false),
    broadcastEligibleRef = useRef(false);

  const load = async () => {
    try {
      setData(await api(`/bookings/${encodeURIComponent(id!)}/tracking`));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [id]);

  useEffect(() => {
    const tripId = data?.tracking?.tripId;
    if (!tripId) return;
    const socket = io(API || window.location.origin, {
      transports: ["websocket"],
    });
    socket.on("connect", () => {
      setOnline(true);
      socket.emit("subscribe", tripId);
    });
    socket.on("disconnect", () => setOnline(false));
    socket.on("tracking:changed", load);
    return () => {
      socket.disconnect();
    };
  }, [data?.tracking?.tripId]);

  useEffect(() => {
    broadcastEligibleRef.current =
      data?.tracking?.phase === "IN_TRANSIT" &&
      Boolean(data?.tracking?.sharing?.canShare);
  }, [data?.tracking?.phase, data?.tracking?.sharing?.canShare]);

  useEffect(
    () => () => {
      if (watchRef.current != null && navigator.geolocation)
        navigator.geolocation.clearWatch(watchRef.current);
      if (sharingRef.current)
        void api(`/bookings/${encodeURIComponent(id!)}/location`, {
          method: "DELETE",
        }).catch(() => undefined);
    },
    [id],
  );

  async function removeSharedReport() {
    if (!sharingRef.current) return;
    try {
      await api(`/bookings/${encodeURIComponent(id!)}/location`, {
        method: "DELETE",
      });
    } catch {
      // The fresh report expires automatically even if this best-effort cleanup fails.
    }
    sharingRef.current = false;
    setSharing(false);
  }

  async function stopGps() {
    if (watchRef.current != null && navigator.geolocation)
      navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = null;
    setGpsActive(false);
    await removeSharedReport();
    setShareMessage(
      "Live GPS stopped. Your last position stays only on this screen until you leave the page.",
    );
    await load();
  }

  function startGps() {
    if (!navigator.geolocation) {
      setShareMessage("This device does not provide browser location.");
      return;
    }
    if (watchRef.current != null) return;

    setShareMessage("Requesting your current location…");
    setGpsActive(true);
    lastSentRef.current = 0;

    watchRef.current = navigator.geolocation.watchPosition(
      async (position) => {
        const local: LocalLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          speedKph:
            position.coords.speed == null
              ? null
              : Math.max(0, position.coords.speed * 3.6),
          heading: position.coords.heading ?? null,
          updatedAt: Date.now(),
        };
        setMyLocation(local);

        if (!broadcastEligibleRef.current) {
          if (sharingRef.current) await removeSharedReport();
          setShareMessage(
            "Your current location is active for this journey. It is private until the bus journey is in progress.",
          );
          return;
        }

        if (Date.now() - lastSentRef.current < 8000) return;
        lastSentRef.current = Date.now();

        try {
          const result = await api(
            `/bookings/${encodeURIComponent(id!)}/location`,
            {
              method: "POST",
              body: JSON.stringify({
                lat: local.lat,
                lng: local.lng,
                accuracy: local.accuracy,
                speedKph: local.speedKph ?? undefined,
                heading: local.heading ?? undefined,
              }),
            },
          );
          sharingRef.current = true;
          setSharing(true);
          setShareMessage(
            result.contributors > 1
              ? `Live journey GPS active · ${result.contributors} passengers are contributing to the bus position.`
              : "Live journey GPS active · your phone is contributing to the bus position.",
          );
          await load();
        } catch (e) {
          sharingRef.current = false;
          setSharing(false);
          setShareMessage(
            `${(e as Error).message} Your own current-location view is still active.`,
          );
        }
      },
      (geoError) => {
        setGpsActive(false);
        setShareMessage(
          geoError.code === geoError.PERMISSION_DENIED
            ? "Location permission was denied. Allow location access in your browser, then press Use my current location again."
            : "Could not read your GPS. Turn on device location services and try again.",
        );
        if (watchRef.current != null)
          navigator.geolocation.clearWatch(watchRef.current);
        watchRef.current = null;
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 15000,
      },
    );
  }

  const tracking = data?.tracking;
  const progress = Math.max(0, Math.min(100, Number(tracking?.progress ?? 0)));
  const location = tracking?.location;
  const destination = tracking?.destination;
  const remainingKm = myLocation
    ? distanceKm(myLocation, destination)
    : null;
  const destinationQuery =
    destination?.lat != null && destination?.lng != null
      ? `${destination.lat},${destination.lng}`
      : destination?.label ?? tracking?.trip?.to ?? "";
  const directionsUrl = myLocation
    ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(
        `${myLocation.lat},${myLocation.lng}`,
      )}&destination=${encodeURIComponent(destinationQuery)}&travelmode=driving`
    : "";

  const help = useMemo(
    () =>
      ((data?.support ?? []) as SupportContact[]).filter((contact) =>
        ["tracking", "delay", "rash-driving", "safety", "medical"].includes(
          contact.id,
        ),
      ),
    [data?.support],
  );

  if (!data && !error)
    return <div className="wrap page loading">Loading live journey…</div>;

  return (
    <div className="wrap page live-journey-page">
      <Link className="back-link" to="/bookings">
        <ArrowLeft size={16} />
        My journeys
      </Link>

      {error && <ErrorBox message={error} retry={load} />}
      {tracking && (
        <>
          <div className="page-heading">
            <div>
              <span className="eyebrow">LIVE JOURNEY</span>
              <h1>
                {tracking.trip.from} → {tracking.trip.to}
              </h1>
              <p>
                {tracking.trip.name} · {dateLabel(tracking.scheduledDeparture)} ·{" "}
                {time(tracking.scheduledDeparture)} IST
              </p>
            </div>
            <span className={`connection ${online ? "connected" : ""}`}>
              <span className="online-dot" />
              {online ? "Live updates connected" : "Refreshing location"}
            </span>
          </div>

          <section className="panel passenger-location-panel">
            <div className="passenger-location-copy">
              <span className="passenger-location-icon">
                <LocateFixed size={20} />
              </span>
              <div>
                <span className="eyebrow">YOUR JOURNEY GPS</span>
                <h2>See your current location → {tracking.trip.to}.</h2>
                <p>
                  Use your phone’s GPS to see where you are now and how far the
                  destination is. Before departure this stays private on your
                  device. While the booked journey is in progress, the same GPS
                  can securely contribute to the shared bus position.
                </p>
              </div>
            </div>
            <button
              className={`button ${gpsActive ? "button-outline sharing-active" : "button-dark"}`}
              onClick={() => (gpsActive ? stopGps() : startGps())}
            >
              {gpsActive ? <StopCircle size={17} /> : <LocateFixed size={17} />}
              {gpsActive
                ? "Stop journey GPS"
                : tracking.phase === "IN_TRANSIT"
                  ? "Start passenger GPS"
                  : "Use my current location"}
            </button>
            <div className="passenger-location-meta">
              <span>
                {tracking.phase === "IN_TRANSIT"
                  ? sharing
                    ? "Your GPS is currently contributing to this bus’s live position."
                    : "The journey is in progress. Start GPS to contribute to live bus tracking."
                  : "Current-location preview is available now; passenger broadcasting begins only while travelling."}
              </span>
              <span>
                Shared reports expire after 2 minutes if your phone stops
                sending updates.
              </span>
            </div>
            {shareMessage && (
              <p className="passenger-share-message" role="status">
                {shareMessage}
              </p>
            )}
          </section>

          {myLocation && (
            <section className="panel personal-route-card">
              <div className="personal-route-heading">
                <div>
                  <span className="eyebrow">YOUR CURRENT ROUTE</span>
                  <h2>You are here → {destination?.label ?? tracking.trip.to}</h2>
                  <p>
                    Live from this device · updated{" "}
                    {new Date(myLocation.updatedAt).toLocaleTimeString("en-IN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                <a
                  className="button button-outline small"
                  href={directionsUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open live directions <ExternalLink size={15} />
                </a>
              </div>

              <div
                className="personal-route-visual"
                aria-label="Current location to destination"
              >
                <div className="map-grid" />
                <div className="personal-route-line" />
                <span className="personal-route-point current">
                  <LocateFixed size={18} />
                </span>
                <span className="personal-route-point destination">
                  <MapPin size={18} />
                </span>
                <div className="personal-route-label current">
                  <small>YOU ARE HERE</small>
                  <strong>
                    {myLocation.lat.toFixed(5)}, {myLocation.lng.toFixed(5)}
                  </strong>
                </div>
                <div className="personal-route-label destination">
                  <small>DESTINATION</small>
                  <strong>{destination?.label ?? tracking.trip.to}</strong>
                </div>
                <div className="personal-route-distance">
                  <Navigation size={18} />
                  <span>
                    {remainingKm == null
                      ? "Live route ready"
                      : `≈ ${remainingKm < 10 ? remainingKm.toFixed(1) : Math.round(remainingKm)} km straight-line remaining`}
                  </span>
                </div>
              </div>

              <div className="personal-route-stats">
                <div>
                  <small>GPS ACCURACY</small>
                  <strong>±{Math.round(myLocation.accuracy)} m</strong>
                </div>
                <div>
                  <small>GPS MODE</small>
                  <strong>
                    {sharing ? "Shared bus tracking" : "Private journey view"}
                  </strong>
                </div>
                <div>
                  <small>DESTINATION</small>
                  <strong>{destination?.label ?? tracking.trip.to}</strong>
                </div>
              </div>
            </section>
          )}

          <section className="panel live-map-card">
            <div className="live-map-top">
              <div>
                <span className="eyebrow">{phaseLabel(tracking.phase)}</span>
                <h2>{sourceLabel(tracking.source)}</h2>
              </div>
              <button
                className="icon-button"
                aria-label="Refresh live location"
                onClick={load}
              >
                <RefreshCw size={17} />
              </button>
            </div>

            {tracking.source === "DEMO_SIMULATION" && (
              <div className="tracking-demo-note">
                No fresh passenger GPS is available yet, so this seeded demo
                trip is showing simulated movement. During travel, confirmed
                passengers using journey GPS replace the simulation with their
                combined live position.
              </div>
            )}

            <div className="journey-live-map" aria-label="Live journey route map">
              <div className="map-grid" />
              <div className="journey-path">
                <div className="journey-path-line" />
                <div
                  className="journey-path-progress"
                  style={{ width: `${progress}%` }}
                />
                <span className="route-map-pin origin">
                  <MapPin size={18} />
                </span>
                <span
                  className="route-map-bus"
                  style={{ left: `calc(${progress}% - 20px)` }}
                >
                  <BusFront size={20} />
                </span>
                <span className="route-map-pin destination">
                  <MapPin size={18} />
                </span>
              </div>
              <div className="map-labels">
                <div>
                  <small>FROM</small>
                  <strong>{tracking.origin?.label ?? tracking.trip.from}</strong>
                </div>
                <div>
                  <small>CURRENT BUS</small>
                  <strong>{location?.label ?? "Waiting for passenger GPS"}</strong>
                </div>
                <div>
                  <small>DESTINATION</small>
                  <strong>
                    {tracking.destination?.label ?? tracking.trip.to}
                  </strong>
                </div>
              </div>
            </div>

            <div className="tracking-stats">
              <article>
                <Navigation size={18} />
                <span>Route progress</span>
                <strong>{progress}%</strong>
              </article>
              <article>
                <Clock3 size={18} />
                <span>Scheduled arrival</span>
                <strong>{time(tracking.scheduledArrival)} IST</strong>
              </article>
              <article>
                <Radio size={18} />
                <span>Bus GPS status</span>
                <strong>{sourceLabel(tracking.source)}</strong>
              </article>
              <article>
                <LocateFixed size={18} />
                <span>Fresh contributors</span>
                <strong>{tracking.contributors ?? 0} passengers</strong>
              </article>
            </div>

            {location && (
              <div className="live-coordinate-row">
                <div>
                  <small>CURRENT BUS POSITION</small>
                  <strong>
                    {Number(location.lat).toFixed(5)},{" "}
                    {Number(location.lng).toFixed(5)}
                  </strong>
                </div>
                <div>
                  <small>LAST PASSENGER GPS UPDATE</small>
                  <strong>
                    {tracking.lastUpdated
                      ? `${time(tracking.lastUpdated)} IST`
                      : tracking.source === "DEMO_SIMULATION"
                        ? "No passenger GPS yet"
                        : "Waiting for passenger GPS"}
                  </strong>
                </div>
                {location.speedKph != null && (
                  <div>
                    <small>ESTIMATED SPEED</small>
                    <strong>{Math.round(location.speedKph)} km/h</strong>
                  </div>
                )}
              </div>
            )}

            <div className="tracking-safety-note">
              <ShieldCheck size={18} />
              <p>
                Your own GPS view is available for every confirmed journey.
                Passenger GPS contributes to the shared bus position only while
                the journey is in progress. Individual raw coordinates are never
                shown to other travellers.
              </p>
            </div>
          </section>

          <section className="panel live-support-panel">
            <div className="admin-section-heading">
              <div>
                <span className="eyebrow">NEED HELP ON THIS JOURNEY?</span>
                <h2>Responsible support contacts</h2>
              </div>
            </div>
            <div className="tracking-support-grid">
              {help.map((contact) => (
                <a
                  className={`tracking-support-card ${contact.priority === "urgent" ? "urgent" : ""}`}
                  href={`tel:${contact.phone.replace(/[^0-9+]/g, "")}`}
                  key={contact.id}
                >
                  <PhoneCall size={17} />
                  <span>
                    <strong>{contact.role}</strong>
                    <small>{contact.issue}</small>
                  </span>
                  <b>{contact.phone}</b>
                </a>
              ))}
            </div>
            <p className="muted small-text">{data.supportDisclaimer}</p>
          </section>
        </>
      )}
    </div>
  );
}
