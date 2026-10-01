import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  BusFront,
  Ticket,
  Clock3,
  RefreshCw,
  IndianRupee,
  Users,
  Plus,
  Activity,
  ArrowRight,
} from "lucide-react";
import { api, money, time, dateLabel } from "./lib";
import { useApp } from "./App";
import { ErrorBox } from "./Booking";
export default function Admin() {
  const { user, notify } = useApp();
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [tab, setTab] = useState("bookings"),
    [create, setCreate] = useState(false),
    [busy, setBusy] = useState(false);
  const load = () =>
    api("/admin/overview")
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    if (user?.role === "admin") {
      load();
      const t = setInterval(load, 10000);
      return () => clearInterval(t);
    }
  }, [user]);
  if (user?.role !== "admin")
    return (
      <div className="empty-state">
        <h1>Operations access required.</h1>
        <p>This area is available to HEAVEN-BUS administrators.</p>
        <Link className="button button-dark" to="/">
          Back home
        </Link>
      </div>
    );
  return (
    <div className="wrap page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">HEAVEN-BUS OPERATIONS</span>
          <h1>Keep every journey moving.</h1>
          <p>Live inventory, booking activity, and payment recovery.</p>
        </div>
        <button
          className="button button-dark"
          onClick={() => setCreate(!create)}
        >
          <Plus size={18} />
          Create trip
        </button>
      </div>
      {error && <ErrorBox message={error} retry={load} />}
      <div className="admin-stats">
        {[
          {
            label: "Confirmed bookings",
            value: data?.totals.count ?? "—",
            icon: Ticket,
          },
          {
            label: "Booked value",
            value: data ? money(data.totals.revenue) : "—",
            icon: IndianRupee,
          },
          {
            label: "Active seat holds",
            value: data?.holds.length ?? "—",
            icon: Clock3,
          },
          {
            label: "Registered travellers",
            value: data?.users ?? "—",
            icon: Users,
          },
        ].map((x) => (
          <article key={x.label}>
            <x.icon size={21} />
            <span>{x.label}</span>
            <strong>{x.value}</strong>
          </article>
        ))}
      </div>
      {create && (
        <section className="panel create-trip">
          <h2>Add a new departure</h2>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const f = new FormData(e.currentTarget);
              try {
                await api("/admin/trips", {
                  method: "POST",
                  body: JSON.stringify({
                    from: f.get("from"),
                    to: f.get("to"),
                    name: f.get("name"),
                    departureAt: new Date(
                      `${f.get("departure")}+05:30`,
                    ).toISOString(),
                    duration: Number(f.get("duration")),
                    fare: Math.round(Number(f.get("fare")) * 100),
                  }),
                });
                notify("Trip published with 40 available seats.");
                setCreate(false);
                load();
              } catch (e) {
                notify((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="form-grid">
              <label>
                Bus name
                <input name="name" required defaultValue="Heaven Express" />
              </label>
              <label>
                Origin
                <input name="from" required placeholder="Bengaluru" />
              </label>
              <label>
                Destination
                <input name="to" required placeholder="Chennai" />
              </label>
              <label>
                Departure in IST
                <input name="departure" type="datetime-local" required />
              </label>
              <label>
                Duration in hours
                <input
                  name="duration"
                  type="number"
                  min="1"
                  max="48"
                  step="0.5"
                  required
                />
              </label>
              <label>
                Fare in rupees
                <input name="fare" type="number" min="100" required />
              </label>
            </div>
            <button className="button button-dark" disabled={busy}>
              {busy ? "Publishing…" : "Publish departure"}
              <ArrowRight size={17} />
            </button>
          </form>
        </section>
      )}
      <div className="admin-tabs" role="tablist">
        {["bookings", "holds", "trips", "refunds", "exceptions"].map((t) => (
          <button
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? "active" : ""}
            key={t}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
        <button
          className="icon-button"
          onClick={load}
          aria-label="Refresh operations"
        >
          <RefreshCw size={16} />
        </button>
      </div>
      <section className="panel admin-table">
        {!data ? (
          <div className="loading">Loading operations…</div>
        ) : tab === "bookings" ? (
          <>
            <h2>Recent bookings</h2>
            <table>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Route</th>
                  <th>Seats</th>
                  <th>Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.bookings.map((b: any) => (
                  <tr key={b._id}>
                    <td>{b.reference}</td>
                    <td>
                      {b.trip.from} → {b.trip.to}
                    </td>
                    <td>{b.seatIds.join(", ")}</td>
                    <td>{money(b.amount)}</td>
                    <td>
                      <span className="status success">Confirmed</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.bookings.length && (
              <p className="table-empty">
                Confirmed bookings will appear here.
              </p>
            )}
          </>
        ) : tab === "holds" ? (
          <>
            <h2>Live seat holds</h2>
            <table>
              <thead>
                <tr>
                  <th>Reservation</th>
                  <th>Seats</th>
                  <th>Expires at IST</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {data.holds.map((h: any) => (
                  <tr key={h._id}>
                    <td>{h._id.slice(0, 8)}</td>
                    <td>{h.seatIds.join(", ")}</td>
                    <td>{time(h.expiresAt)}</td>
                    <td>
                      <span className="status">
                        {h.state.replaceAll("_", " ")}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.holds.length && (
              <p className="table-empty">No active holds right now.</p>
            )}
          </>
        ) : tab === "trips" ? (
          <>
            <h2>Upcoming departures</h2>
            <table>
              <thead>
                <tr>
                  <th>Bus</th>
                  <th>Route</th>
                  <th>Departure</th>
                  <th>Fare</th>
                  <th>Inventory</th>
                </tr>
              </thead>
              <tbody>
                {data.trips.map((t: any) => (
                  <tr key={t._id}>
                    <td>{t.name}</td>
                    <td>
                      {t.from} → {t.to}
                    </td>
                    <td>
                      {dateLabel(t.date)} · {time(t.departureAt)}
                    </td>
                    <td>{money(t.fare)}</td>
                    <td>
                      <Link
                        to={`/trip/${encodeURIComponent(t._id)}`}
                        className="text-link"
                      >
                        View seats
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : tab === "refunds" ? (
          <>
            <h2>Refund recovery</h2>
            <table>
              <thead>
                <tr>
                  <th>Payment</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Attempts</th>
                </tr>
              </thead>
              <tbody>
                {data.refunds.map((r: any) => (
                  <tr key={r._id}>
                    <td>{r._id.slice(0, 24)}</td>
                    <td>{money(r.amount)}</td>
                    <td>
                      <span className="status">{r.status}</span>
                    </td>
                    <td>{r.attempts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.refunds.length && (
              <p className="table-empty">
                No refund obligations. Recovery runs automatically.
              </p>
            )}
          </>
        ) : (
          <>
            <h2>Payment exceptions</h2>
            <p className="muted">
              Unknown provider outcomes are retained for reconciliation. Never
              resubmit a payment or refund without checking the provider.
            </p>
            {data.orders.map((o: any) => (
              <div className="summary-row" key={o._id}>
                <span>{o._id.slice(0, 12)}</span>
                <strong>{o.status}</strong>
                <span>{dateLabel(o.createdAt)}</span>
              </div>
            ))}
            {!data.orders.length && (
              <p className="table-empty">
                <Activity size={20} /> No payment exceptions to review.
              </p>
            )}
          </>
        )}
      </section>
      <p className="muted small-text">
        Updates every 10 seconds · Demo operations · All times IST
      </p>
    </div>
  );
}
