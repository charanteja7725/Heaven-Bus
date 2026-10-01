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
  Ban,
  Play,
  Trash2,
  CheckCircle2,
  XCircle,
  CircleDollarSign,
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
    [busy, setBusy] = useState(false),
    [tripBusy, setTripBusy] = useState(""),
    [refundBusy, setRefundBusy] = useState("");
  const load = () =>
    api("/admin/overview")
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((e) => setError(e.message));

  async function manageTrip(
    tripId: string,
    action: "stop" | "resume" | "remove",
  ) {
    const messages = {
      stop:
        "Stop sales for this trip? Active seat holds will be released, but confirmed tickets will remain valid.",
      resume: "Resume sales for this trip?",
      remove:
        "Remove this trip permanently? This is only allowed when there are no confirmed tickets or active payment/hold activity.",
    };
    if (!window.confirm(messages[action])) return;
    setTripBusy(`${tripId}:${action}`);
    try {
      await api(
        action === "remove"
          ? `/admin/trips/${encodeURIComponent(tripId)}`
          : `/admin/trips/${encodeURIComponent(tripId)}/${action}`,
        { method: action === "remove" ? "DELETE" : "POST" },
      );
      notify(
        action === "stop"
          ? "Trip sales stopped. Existing confirmed tickets were preserved."
          : action === "resume"
            ? "Trip sales resumed."
            : "Trip removed.",
      );
      await load();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setTripBusy("");
    }
  }
  async function manageRefund(
    refundId: string,
    action: "approve" | "reject",
  ) {
    let body: string | undefined;
    if (action === "approve") {
      if (!window.confirm("Approve this refund request? The refund will move to processing."))
        return;
    } else {
      const reason = window.prompt(
        "Reason for rejecting this refund request:",
        "Refund request does not meet approval requirements.",
      );
      if (!reason?.trim()) return;
      body = JSON.stringify({ reason: reason.trim() });
    }

    setRefundBusy(`${refundId}:${action}`);
    try {
      await api(
        `/admin/refunds/${encodeURIComponent(refundId)}/${action}`,
        { method: "POST", body },
      );
      notify(
        action === "approve"
          ? "Refund approved and queued for processing."
          : "Refund request rejected.",
      );
      await load();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setRefundBusy("");
    }
  }

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
          {
            label: "Refund approvals",
            value:
              data?.refunds.filter(
                (r: any) =>
                  r.reason === "PASSENGER_CANCELLATION" &&
                  r.status === "PENDING_APPROVAL",
              ).length ?? "—",
            icon: CircleDollarSign,
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
                      <span className={`status ${b.status === "CONFIRMED" ? "success" : ""}`}>
                        {b.status === "CANCELLED" ? "Cancelled" : "Confirmed"}
                      </span>
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
                  <th>Status</th>
                  <th>Inventory</th>
                  <th>Actions</th>
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
                      <span className={`status ${t.status === "PUBLISHED" ? "success" : ""}`}>
                        {t.status === "PUBLISHED" ? "On sale" : "Stopped"}
                      </span>
                    </td>
                    <td>
                      <Link
                        to={`/trip/${encodeURIComponent(t._id)}`}
                        className="text-link"
                      >
                        View seats
                      </Link>
                    </td>
                    <td>
                      <div className="admin-trip-actions">
                        {t.status === "PUBLISHED" ? (
                          <button
                            className="text-link"
                            disabled={tripBusy.startsWith(t._id)}
                            onClick={() => manageTrip(t._id, "stop")}
                          >
                            <Ban size={14} /> Stop sales
                          </button>
                        ) : (
                          <button
                            className="text-link"
                            disabled={tripBusy.startsWith(t._id)}
                            onClick={() => manageTrip(t._id, "resume")}
                          >
                            <Play size={14} /> Resume
                          </button>
                        )}
                        <button
                          className="text-link"
                          disabled={tripBusy.startsWith(t._id)}
                          onClick={() => manageTrip(t._id, "remove")}
                        >
                          <Trash2 size={14} /> Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : tab === "refunds" ? (
          <>
            <div className="admin-section-heading">
              <div>
                <h2>Refund approvals</h2>
                <p className="muted small-text">
                  Passenger cancellation refunds require an administrator decision.
                  Payment-safety refunds continue automatically.
                </p>
              </div>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Booking</th>
                  <th>Traveller</th>
                  <th>Route</th>
                  <th>Amount</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Requested</th>
                  <th>Decision</th>
                </tr>
              </thead>
              <tbody>
                {data.refunds.map((r: any) => {
                  const passengerRefund =
                    r.reason === "PASSENGER_CANCELLATION";
                  const canApprove =
                    passengerRefund &&
                    ["PENDING_APPROVAL", "REJECTED"].includes(r.status);
                  const canReject =
                    passengerRefund && r.status === "PENDING_APPROVAL";
                  return (
                    <tr key={r._id}>
                      <td>
                        <strong>{r.booking?.reference ?? r._id.slice(0, 12)}</strong>
                        {r.booking?.seatIds?.length ? (
                          <div className="muted small-text">
                            Seats {r.booking.seatIds.join(", ")}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {r.traveller?.name ?? "Traveller"}
                        <div className="muted small-text">
                          {r.traveller?.email ?? "—"}
                        </div>
                      </td>
                      <td>
                        {r.booking?.trip
                          ? `${r.booking.trip.from} → ${r.booking.trip.to}`
                          : "—"}
                      </td>
                      <td>
                        <strong>{money(r.amount)}</strong>
                        {r.originalAmount && r.originalAmount !== r.amount ? (
                          <div className="muted small-text">
                            of {money(r.originalAmount)}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {passengerRefund
                          ? "Ticket cancellation"
                          : "Payment safety"}
                      </td>
                      <td>
                        <span
                          className={`status ${r.status === "COMPLETED" ? "success" : ""}`}
                        >
                          {r.status === "PENDING_APPROVAL"
                            ? "Awaiting approval"
                            : r.status === "PENDING"
                              ? "Approved · Processing"
                              : r.status === "COMPLETED"
                                ? "Refunded"
                                : r.status === "REJECTED"
                                  ? "Rejected"
                                  : r.status.replaceAll("_", " ")}
                        </span>
                        {r.rejectionReason ? (
                          <div className="muted small-text" style={{ marginTop: 6 }}>
                            {r.rejectionReason}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {dateLabel(r.requestedAt ?? r.createdAt)}
                      </td>
                      <td>
                        {passengerRefund ? (
                          <div className="admin-trip-actions">
                            <button
                              className="text-link"
                              disabled={
                                !canApprove || refundBusy.startsWith(r._id)
                              }
                              onClick={() => manageRefund(r._id, "approve")}
                            >
                              <CheckCircle2 size={14} />
                              {r.status === "REJECTED" ? "Reconsider" : "Approve"}
                            </button>
                            <button
                              className="text-link danger-link"
                              disabled={
                                !canReject || refundBusy.startsWith(r._id)
                              }
                              onClick={() => manageRefund(r._id, "reject")}
                            >
                              <XCircle size={14} /> Reject
                            </button>
                          </div>
                        ) : (
                          <span className="muted small-text">
                            Automatic safety refund
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!data.refunds.length && (
              <p className="table-empty">No refund requests right now.</p>
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
