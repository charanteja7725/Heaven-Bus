import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { io } from "socket.io-client";
import {
  ArrowLeft,
  BusFront,
  Clock3,
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

export default function TrackingPage() {
  const { id } = useParams();
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [online, setOnline] = useState(false),
    [sharing, setSharing] = useState(false),
    [shareMessage, setShareMessage] = useState("");
  const watchRef = useRef<number | null>(null),
    lastSentRef = useRef(0),
    sharingRef = useRef(false);

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

  async function stopSharing(showMessage = true) {
    if (watchRef.current != null && navigator.geolocation)
      navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = null;
    sharingRef.current = false;
    setSharing(false);
    try {
      await api(`/bookings/${encodeURIComponent(id!)}/location`, {
        method: "DELETE",
      });
      if (showMessage)
        setShareMessage("Location sharing stopped. Your report was removed.");
      await load();
    } catch (e) {
      if (showMessage) setShareMessage((e as Error).message);
    }
  }

  function startSharing() {
    if (!navigator.geolocation) {
      setShareMessage("This device does not provide browser location.");
      return;
    }
    if (!data?.tracking?.sharing?.canShare) {
      setShareMessage(
        "Location sharing is available from two hours before departure until two hours after scheduled arrival.",
      );
      return;
    }

    setShareMessage("Requesting location permission…");
    lastSentRef.current = 0;
    watchRef.current = navigator.geolocation.watchPosition(
      async (position) => {
        if (Date.now() - lastSentRef.current < 8000) return;
        lastSentRef.current = Date.now();
        try {
          const result = await api(
            `/bookings/${encodeURIComponent(id!)}/location`,
            {
              method: "POST",
              body: JSON.stringify({
                lat: position.coords.latitude,
                lng: position.coords.longitude,
                accuracy: position.coords.accuracy,
                speedKph:
                  position.coords.speed == null
                    ? undefined
                    : Math.max(0, position.coords.speed * 3.6),
                heading: position.coords.heading ?? undefined,
              }),
            },
          );
          sharingRef.current = true;
          setSharing(true);
          setShareMessage(
            result.contributors > 1
              ? `Sharing live location · ${result.contributors} passengers are contributing.`
              : "Sharing live location · your GPS is helping locate the bus.",
          );
          await load();
        } catch (e) {
          setShareMessage((e as Error).message);
          await stopSharing(false);
        }
      },
      (geoError) => {
        sharingRef.current = false;
        setSharing(false);
        setShareMessage(
          geoError.code === geoError.PERMISSION_DENIED
            ? "Location permission was denied. Allow location access to help track this journey."
            : "Could not read your GPS. Try again with location services enabled.",
        );
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
                <span className="eyebrow">PASSENGER-POWERED LIVE LOCATION</span>
                <h2>Help passengers see where the bus is.</h2>
                <p>
                  While you are on this confirmed journey, you can share your
                  phone’s GPS. HEAVEN-BUS combines fresh passenger reports into
                  one bus position. Other passengers never see your individual
                  raw location.
                </p>
              </div>
            </div>
            <button
              className={`button ${sharing ? "button-outline sharing-active" : "button-dark"}`}
              disabled={!tracking.sharing?.canShare && !sharing}
              onClick={() => (sharing ? stopSharing() : startSharing())}
            >
              {sharing ? <StopCircle size={17} /> : <LocateFixed size={17} />}
              {sharing ? "Stop sharing" : "Share my live location"}
            </button>
            <div className="passenger-location-meta">
              <span>
                {tracking.sharing?.canShare
                  ? "Sharing window is open for this journey."
                  : `Sharing opens ${time(tracking.sharing?.opensAt)} IST, two hours before departure.`}
              </span>
              <span>
                Reports automatically expire after 2 minutes if your phone stops
                sending updates.
              </span>
            </div>
            {shareMessage && (
              <p className="passenger-share-message" role="status">
                {shareMessage}
              </p>
            )}
          </section>

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
                passengers can opt in above and their combined GPS replaces the
                simulation.
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
                <span>GPS status</span>
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
                Passenger GPS is used only to estimate the bus position for this
                journey. Individual passenger coordinates are not shown to other
                travellers. For safety, medical, rash-driving or delay concerns,
                use the responsible support desk below.
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
