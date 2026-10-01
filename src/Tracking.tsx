import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { io } from "socket.io-client";
import {
  ArrowLeft,
  BusFront,
  Clock3,
  MapPin,
  Navigation,
  PhoneCall,
  Radio,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { API, api, dateLabel, time, type SupportContact } from "./lib";
import { ErrorBox } from "./Booking";

function phaseLabel(phase?: string) {
  if (phase === "IN_TRANSIT") return "Journey in progress";
  if (phase === "ARRIVED") return "Arrived at destination";
  return "Waiting for departure";
}

function sourceLabel(source?: string) {
  if (source === "LIVE_GPS") return "Live GPS";
  if (source === "DEMO_SIMULATION") return "Demo simulated movement";
  if (source === "STALE_GPS") return "Last known GPS";
  return "Scheduled position";
}

export default function TrackingPage() {
  const { id } = useParams();
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [online, setOnline] = useState(false);

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

          <section className="panel live-map-card">
            <div className="live-map-top">
              <div>
                <span className="eyebrow">{phaseLabel(tracking.phase)}</span>
                <h2>{sourceLabel(tracking.source)}</h2>
              </div>
              <button className="icon-button" aria-label="Refresh live location" onClick={load}>
                <RefreshCw size={17} />
              </button>
            </div>

            {tracking.source === "DEMO_SIMULATION" && (
              <div className="tracking-demo-note">
                This seeded demo trip is using simulated movement. A real bus
                replaces this automatically when an operator starts GPS broadcast.
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
                  <strong>{location?.label ?? "Waiting for GPS"}</strong>
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
            </div>

            {location && (
              <div className="live-coordinate-row">
                <div>
                  <small>CURRENT POSITION</small>
                  <strong>
                    {Number(location.lat).toFixed(5)},{" "}
                    {Number(location.lng).toFixed(5)}
                  </strong>
                </div>
                <div>
                  <small>LAST GPS UPDATE</small>
                  <strong>
                    {tracking.lastUpdated
                      ? `${time(tracking.lastUpdated)} IST`
                      : tracking.source === "DEMO_SIMULATION"
                        ? "Live demo clock"
                        : "No operator GPS yet"}
                  </strong>
                </div>
                {location.speedKph != null && (
                  <div>
                    <small>SPEED</small>
                    <strong>{Math.round(location.speedKph)} km/h</strong>
                  </div>
                )}
              </div>
            )}

            <div className="tracking-safety-note">
              <ShieldCheck size={18} />
              <p>
                GPS location is for journey awareness. For immediate safety,
                medical, rash-driving or delay concerns, use the responsible
                support desk below.
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
