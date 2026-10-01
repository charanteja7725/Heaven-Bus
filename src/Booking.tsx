import { useEffect, useRef, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { io } from "socket.io-client";
import {
  ArrowRight,
  ArrowLeft,
  BusFront,
  Clock3,
  ShieldCheck,
  Plug,
  Wind,
  Droplets,
  SlidersHorizontal,
  Sparkles,
  Armchair,
  Check,
  Ticket,
  Printer,
  RefreshCw,
  AlertCircle,
  XCircle,
} from "lucide-react";
import {
  API,
  api,
  money,
  time,
  dateLabel,
  today,
  type Trip,
  type Hold,
  type PassengerGender,
} from "./lib";
import { useApp } from "./App";
import { SearchForm } from "./Home";
export function ErrorBox({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <div className="error-box" role="alert">
      <AlertCircle size={22} />
      <div>
        <strong>Let’s get you back on track.</strong>
        <p>{message}</p>
        {retry && (
          <button className="text-link" onClick={retry}>
            Try again <RefreshCw size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

function genderLabel(gender?: PassengerGender | null) {
  if (gender === "FEMALE") return "Female";
  if (gender === "MALE") return "Male";
  if (gender === "OTHER") return "Other";
  return "Not set";
}

function adjacentSeatId(seatId: string) {
  const match = seatId.match(/^(\d+)([ABCD])$/);
  if (!match) return null;
  const partner: Record<string, string> = {
    A: "B",
    B: "A",
    C: "D",
    D: "C",
  };
  return `${match[1]}${partner[match[2]]}`;
}

export function TripCard({ trip: t }: { trip: Trip }) {
  return (
    <article className="trip-card">
      <div className="trip-top">
        <span className="operator-logo">
          <BusFront size={23} />
        </span>
        <div>
          <h3>{t.name}</h3>
          <p>{t.type} · 2 + 2 layout</p>
        </div>
        <span className="trip-badge">
          <ShieldCheck size={13} /> Protected holds
        </span>
      </div>
      <div className="trip-middle">
        <div>
          <strong>{time(t.departureAt)}</strong>
          <span>{t.from}</span>
        </div>
        <div className="trip-duration">
          <small>{t.duration}h journey</small>
          <div className="route-line" />
          <span>Direct journey</span>
        </div>
        <div>
          <strong>{time(t.arrivalAt)}</strong>
          <span>{t.to}</span>
        </div>
        <div className="trip-price">
          <small>per person</small>
          <strong>{money(t.fare)}</strong>
          <span>{t.available} seats available</span>
        </div>
      </div>
      <div className="trip-bottom">
        <div className="amenities">
          <span>
            <Wind size={15} />
            AC
          </span>
          <span>
            <Plug size={15} />
            Charging
          </span>
          <span>
            <Droplets size={15} />
            Water
          </span>
        </div>
        <Link
          className="button button-dark small"
          to={`/trip/${encodeURIComponent(t._id)}`}
        >
          Choose seats <ArrowRight size={16} />
        </Link>
      </div>
    </article>
  );
}
export function SearchPage() {
  const [params] = useSearchParams(),
    { openJarvis } = useApp();
  const from = params.get("from") ?? "Bengaluru",
    to = params.get("to") ?? "Chennai",
    date = params.get("date") ?? today();
  const [trips, setTrips] = useState<Trip[]>([]),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [sort, setSort] = useState("departure"),
    [max, setMax] = useState(3000),
    [night, setNight] = useState(false);
  const load = () => {
    setBusy(true);
    setError("");
    api(`/trips?${new URLSearchParams({ from, to, date })}`)
      .then(setTrips)
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };
  useEffect(load, [from, to, date]);
  const filtered = trips
    .filter(
      (t) =>
        t.fare <= max * 100 &&
        (!night || Number(time(t.departureAt).slice(0, 2)) >= 18),
    )
    .sort((a, b) =>
      sort === "price"
        ? a.fare - b.fare
        : sort === "duration"
          ? a.duration - b.duration
          : a.departureAt.localeCompare(b.departureAt),
    );
  return (
    <div className="wrap page">
      <div className="search-compact">
        <SearchForm key={`${from}${to}${date}`} initial={{ from, to, date }} />
      </div>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR NEXT JOURNEY</span>
          <h1>
            {from} <span className="heading-arrow">→</span> {to}
          </h1>
          <p>
            {dateLabel(date)} · All times IST ·{" "}
            {busy
              ? "Finding your options…"
              : `${filtered.length} buses to take you there`}
          </p>
        </div>
        <label className="sort-label">
          Sort by{" "}
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="departure">Departure time</option>
            <option value="price">Lowest price</option>
            <option value="duration">Shortest journey</option>
          </select>
        </label>
      </div>
      <div className="results-layout">
        <aside className="filters">
          <h3>
            <SlidersHorizontal size={18} /> A trip your way
          </h3>
          <label>
            Maximum fare <strong>₹{max.toLocaleString("en-IN")}</strong>
            <input
              aria-label="Maximum fare"
              type="range"
              min="400"
              max="3000"
              step="100"
              value={max}
              onChange={(e) => setMax(Number(e.target.value))}
            />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={night}
              onChange={(e) => setNight(e.target.checked)}
            />
            Evening departures
          </label>
          <button
            className="text-link"
            onClick={() => {
              setMax(3000);
              setNight(false);
            }}
          >
            Reset filters
          </button>
          <div className="filter-jarvis">
            <Sparkles />
            <h3>
              Less scrolling.
              <br />
              More going.
            </h3>
            <p>Tell Jarvis what your ideal journey looks like.</p>
            <button
              className="text-link"
              onClick={() => openJarvis(`${from} to ${to} on ${date}`)}
            >
              Ask Jarvis <ArrowRight size={15} />
            </button>
          </div>
        </aside>
        <section className="results-list">
          {error ? (
            <ErrorBox message={error} retry={load} />
          ) : busy ? (
            <div className="loading">Finding your next journey…</div>
          ) : filtered.length ? (
            filtered.map((t) => <TripCard key={t._id} trip={t} />)
          ) : (
            <div className="empty-state compact">
              <BusFront size={38} />
              <h2>No buses on this route just yet.</h2>
              <p>
                Try another date or reset your filters. Demo schedules cover the
                next 14 days.
              </p>
              <button
                className="button button-dark"
                onClick={() => openJarvis()}
              >
                Find a route with Jarvis
              </button>
            </div>
          )}
          <p className="muted small-text">
            Demo schedules and fares. Seat availability is shared live between
            all users.
          </p>
        </section>
      </div>
    </div>
  );
}
export function SeatPage() {
  const { id } = useParams(),
    { user, notify } = useApp(),
    nav = useNavigate();
  const [trip, setTrip] = useState<Trip | null>(null),
    [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [online, setOnline] = useState(false),
    [tick, setTick] = useState(Date.now()),
    [offset, setOffset] = useState(0),
    [activeGender, setActiveGender] = useState<PassengerGender | null>(null);
  const sequence = useRef(0);
  const load = async () => {
    const seq = ++sequence.current;
    try {
      const result = await api(`/trips/${encodeURIComponent(id!)}/seats`);
      if (seq !== sequence.current) return;
      setData(result);
      setOffset(new Date(result.serverNow).getTime() - Date.now());
      setError("");
    } catch (e) {
      if (seq === sequence.current) setError((e as Error).message);
    }
  };
  useEffect(() => {
    api(`/trips/${encodeURIComponent(id!)}`)
      .then(setTrip)
      .catch((e) => setError(e.message));
    load();
    const socket = io(API || window.location.origin, {
      transports: ["websocket"],
    });
    socket.on("connect", () => {
      setOnline(true);
      socket.emit("subscribe", id);
      load();
    });
    socket.on("disconnect", () => setOnline(false));
    socket.on("subscribed", load);
    socket.on("seats:changed", load);
    const refresh = setInterval(load, 5000),
      clock = setInterval(() => setTick(Date.now()), 1000);
    window.addEventListener("focus", load);
    return () => {
      sequence.current++;
      socket.disconnect();
      clearInterval(refresh);
      clearInterval(clock);
      window.removeEventListener("focus", load);
    };
  }, [id, user?._id]);
  const hold: Hold | null = data?.hold ?? null;
  const remaining = hold
    ? Math.max(
        0,
        Math.ceil((new Date(hold.expiresAt).getTime() - tick - offset) / 1000),
      )
    : 0;
  const selected = remaining ? (hold?.seatIds ?? []) : [];
  function seatRestriction(seatId: string, gender = activeGender) {
    if (!gender) return null;
    const partnerId = adjacentSeatId(seatId);
    if (!partnerId) return null;

    if (selected.includes(partnerId)) {
      const partnerGender = hold?.seatGenders?.[partnerId];
      return partnerGender && partnerGender !== gender
        ? {
            partnerId,
            gender: partnerGender,
            reason: `Seat ${seatId} must match the gender selected for adjacent seat ${partnerId}.`,
          }
        : null;
    }

    const partner = data?.seats?.find((s: any) => s.seatId === partnerId);
    if (!partner) return null;
    const expired =
      partner.state === "HELD" &&
      partner.expiresAt &&
      new Date(partner.expiresAt).getTime() <= tick + offset;
    const occupied =
      partner.state === "BOOKED" ||
      (partner.state === "HELD" && !expired);
    return occupied && partner.gender && partner.gender !== gender
      ? {
          partnerId,
          gender: partner.gender as PassengerGender,
          reason: `Seat ${seatId} can only be booked for a ${genderLabel(partner.gender).toLowerCase()} passenger because adjacent seat ${partnerId} is occupied.`,
        }
      : null;
  }

  async function toggle(seat: string) {
    if (!user) {
      nav(`/login?next=${encodeURIComponent(`/trip/${id}`)}`);
      return;
    }
    if (busy) return;

    const removing = selected.includes(seat);
    if (!removing && !activeGender) {
      notify("Choose the passenger gender before selecting a seat.");
      return;
    }

    const restriction = !removing ? seatRestriction(seat) : null;
    if (restriction) {
      notify(restriction.reason);
      return;
    }

    const next = removing
      ? selected.filter((x) => x !== seat)
      : [...selected, seat];
    if (next.length > 6) {
      notify("You can reserve up to six seats.");
      return;
    }

    const seatGenders = { ...(hold?.seatGenders ?? {}) } as Record<
      string,
      PassengerGender
    >;
    if (removing) delete seatGenders[seat];
    else seatGenders[seat] = activeGender!;

    setBusy(true);
    try {
      await api("/holds", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          tripId: id,
          seatIds: next,
          seatGenders,
        }),
      });
      await load();
    } catch (e) {
      notify((e as Error).message);
      await load();
    } finally {
      setBusy(false);
    }
  }
  if (!trip)
    return (
      <div className="wrap page">
        {error ? (
          <ErrorBox message={error} />
        ) : (
          <div className="loading">Getting your bus ready…</div>
        )}
      </div>
    );
  return (
    <div className="wrap page">
      <Link
        className="back-link"
        to={`/search?from=${trip.from}&to=${trip.to}&date=${trip.date}`}
      >
        <ArrowLeft size={16} />
        Back to buses
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">MAKE YOURSELF COMFORTABLE</span>
          <h1>Find your happy place.</h1>
          <p>
            {trip.from} → {trip.to} · {dateLabel(trip.date)} ·{" "}
            {time(trip.departureAt)} IST
          </p>
        </div>
        <span className={`connection ${online ? "connected" : ""}`}>
          <span className="online-dot" />
          {online ? "Live seat updates" : "Refreshing availability"}
        </span>
      </div>
      {error && <ErrorBox message={error} retry={load} />}
      <div className="seat-layout">
        <section className="seat-panel">
          <div className="panel-heading">
            <div>
              <h2>{trip.name}</h2>
              <p>{trip.type} · 40 seats</p>
            </div>
            <BusFront size={30} />
          </div>
          <div className="gender-seat-picker">
            <div>
              <strong>Who is this seat for?</strong>
              <span>Select a gender, then choose the seat.</span>
            </div>
            <div className="gender-options" role="group" aria-label="Passenger gender for next seat">
              {(["FEMALE", "MALE", "OTHER"] as PassengerGender[]).map((gender) => (
                <button
                  key={gender}
                  type="button"
                  className={`gender-option ${activeGender === gender ? "active" : ""} ${gender.toLowerCase()}`}
                  aria-pressed={activeGender === gender}
                  onClick={() => setActiveGender(gender)}
                >
                  {genderLabel(gender)}
                </button>
              ))}
            </div>
            <p>
              Adjacent seats are restricted to the same gender once one seat in the pair is held or booked.
            </p>
          </div>
          <div className="seat-map-wrap">
            <div className="seat-legend">
              <span>
                <i />
                Available
              </span>
              <span>
                <i className="chosen" />
                Yours
              </span>
              <span>
                <i className="held" />
                On hold
              </span>
              <span>
                <i className="booked" />
                Booked
              </span>
              <span>
                <i className="booked-female" />
                Booked · female
              </span>
              <span>
                <i className="restricted" />
                Gender restricted
              </span>
            </div>
            <div className="bus-frame">
              <div className="driver">
                <span>FRONT OF BUS</span>
                <span className="steering">◉</span>
              </div>
              <div className="seat-grid">
                {Array.from({ length: 40 }, (_, i) => {
                  const seatId = `${Math.floor(i / 4) + 1}${"ABCD"[i % 4]}`;
                  const seat = data?.seats.find(
                    (s: any) => s.seatId === seatId,
                  );
                  const expired =
                    seat?.state === "HELD" &&
                    new Date(seat.expiresAt).getTime() <= tick + offset;
                  const state = expired ? "AVAILABLE" : seat?.state;
                  const mine = selected.includes(seatId);
                  const restriction = !mine
                    ? seatRestriction(seatId)
                    : null;
                  const femaleBooked =
                    state === "BOOKED" && seat?.gender === "FEMALE";
                  const genderClass = femaleBooked
                    ? "booked-female"
                    : state === "BOOKED"
                      ? "booked"
                      : state === "HELD"
                        ? "held"
                        : restriction
                          ? "restricted"
                          : "";
                  const disabled =
                    busy ||
                    !!error ||
                    !seat ||
                    state === "BOOKED" ||
                    (state === "HELD" && !mine) ||
                    hold?.state === "PAYMENT_PENDING" ||
                    !!restriction;
                  return (
                    <button
                      key={seatId}
                      aria-label={
                        `Seat ${seatId}, ` +
                        (mine
                          ? `held by you for a ${genderLabel(hold?.seatGenders?.[seatId]).toLowerCase()} passenger`
                          : femaleBooked
                            ? "booked by a female passenger"
                            : restriction
                              ? restriction.reason
                              : state?.toLowerCase() ?? "loading")
                      }
                      aria-pressed={mine}
                      title={restriction?.reason ?? undefined}
                      disabled={disabled}
                      onClick={() => toggle(seatId)}
                      className={`seat ${mine ? "selected" : genderClass} ${mine ? (hold?.seatGenders?.[seatId] ?? "").toLowerCase() : ""} ${i % 4 === 2 ? "aisle" : ""}`}
                    >
                      <Armchair size={26} />
                      <span>{seatId}</span>
                      {mine && hold?.seatGenders?.[seatId] && (
                        <b className="seat-gender-badge">
                          {genderLabel(hold.seatGenders[seatId]).charAt(0)}
                        </b>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="bus-rear">WINDOW SEATS: A & D</div>
            </div>
          </div>
        </section>
        <aside className="booking-summary">
          <span className="eyebrow">YOUR LITTLE ESCAPE</span>
          <h2>
            {trip.from}
            <ArrowRight size={22} />
            {trip.to}
          </h2>
          <div className="summary-route">
            <div>
              <span className="route-dot" />
              <div>
                <strong>
                  {time(trip.departureAt)} · {trip.from}
                </strong>
                <p>{dateLabel(trip.departureAt)} · Main bus terminal</p>
              </div>
            </div>
            <div>
              <span className="route-dot end" />
              <div>
                <strong>
                  {time(trip.arrivalAt)} · {trip.to}
                </strong>
                <p>{dateLabel(trip.arrivalAt)} · Main bus terminal</p>
              </div>
            </div>
          </div>
          {selected.length > 0 ? (
            <>
              <div className="hold-timer">
                <Clock3 size={18} />
                <span>These seats are yours for</span>
                <strong>
                  {Math.floor(remaining / 60)}:
                  {String(remaining % 60).padStart(2, "0")}
                </strong>
              </div>
              <div className="summary-row seat-assignment-summary">
                <span>Your seats</span>
                <strong>
                  {selected.map((seatId) => (
                    <span className="seat-assignment-chip" key={seatId}>
                      {seatId} · {genderLabel(hold?.seatGenders?.[seatId])}
                    </span>
                  ))}
                </strong>
              </div>
              <div className="summary-row">
                <span>
                  {selected.length} × {money(trip.fare)}
                </span>
                <strong>{money(trip.fare * selected.length)}</strong>
              </div>
              <div className="summary-total">
                <span>Total fare</span>
                <strong>{money(trip.fare * selected.length)}</strong>
              </div>
              <button
                className="button button-dark full"
                disabled={busy}
                onClick={() => nav(`/checkout/${hold!._id}`)}
              >
                Continue to passengers <ArrowRight size={18} />
              </button>
              {hold?.state === "ACTIVE" && (
                <button
                  className="text-link release"
                  onClick={async () => {
                    try {
                      await api(`/holds/${hold._id}`, { method: "DELETE" });
                      load();
                    } catch (e) {
                      notify((e as Error).message);
                    }
                  }}
                >
                  Release my seats
                </button>
              )}
            </>
          ) : (
            <div className="select-prompt">
              <Armchair size={35} />
              <h3>A window or an aisle?</h3>
              <p>
                Select up to six seats. Your five-minute hold starts with your
                first selection.
              </p>
            </div>
          )}
          <p className="summary-note">
            <ShieldCheck size={16} />
            Your seat is protected while you complete your booking.
          </p>
        </aside>
      </div>
    </div>
  );
}
export function CheckoutPage() {
  const { id } = useParams(),
    { notify } = useApp(),
    nav = useNavigate();
  const [hold, setHold] = useState<Hold | null>(null),
    [trip, setTrip] = useState<Trip | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [order, setOrder] = useState<any>(null),
    [remaining, setRemaining] = useState(0);
  const offset = useRef(0);
  const refresh = async () => {
    try {
      const h = await api(`/holds/${id}`);
      setHold(h);
      if (h.serverNow)
        offset.current = new Date(h.serverNow).getTime() - Date.now();
      if (h.order) setOrder(h.order);
      if (h.state === "CONFIRMED") nav(`/ticket/${id}`, { replace: true });
      if (!trip) api(`/trips/${encodeURIComponent(h.tripId)}`).then(setTrip);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [id]);
  useEffect(() => {
    const update = () =>
      setRemaining(
        Math.max(
          0,
          Math.ceil(
            (new Date(hold?.expiresAt ?? 0).getTime() -
              Date.now() -
              offset.current) /
              1000,
          ),
        ),
      );
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [hold?.expiresAt]);
  async function launch(o: any) {
    if (o.mode === "sandbox") {
      setOrder(o);
      return;
    }
    if (!o.providerOrderId) {
      notify(
        "Your payment order is being checked. Please wait; do not start another payment.",
      );
      return;
    }
    if (!(window as any).Razorpay)
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://checkout.razorpay.com/v1/checkout.js";
        script.onload = () => resolve();
        script.onerror = () =>
          reject(new Error("Checkout could not load. Please try again."));
        document.body.append(script);
      });
    const checkout = new (window as any).Razorpay({
      key: o.keyId,
      order_id: o.providerOrderId,
      amount: o.amount,
      currency: "INR",
      name: "HEAVEN-BUS",
      description: "Demo bus booking",
      handler: async (result: any) => {
        try {
          const r = await api(`/holds/${id}/verify`, {
            method: "POST",
            body: JSON.stringify({
              paymentId: result.razorpay_payment_id,
              signature: result.razorpay_signature,
            }),
          });
          if (r.status === "CONFIRMED") nav(`/ticket/${id}`);
          else
            notify(
              r.status === "REFUND_PENDING"
                ? "Your hold expired. A refund has been requested."
                : "Payment is being verified. Keep this page open or check My journeys.",
            );
          await refresh();
        } catch (e) {
          setError((e as Error).message);
        }
      },
    });
    checkout.open();
  }
  if (!hold)
    return (
      <div className="wrap page">
        {error ? (
          <ErrorBox message={error} retry={refresh} />
        ) : (
          <div className="loading">Loading your reservation…</div>
        )}
      </div>
    );
  const paymentOutcome = hold.payment?.outcome;
  return (
    <div className="wrap page checkout">
      <Link
        to={`/trip/${encodeURIComponent(hold.tripId)}`}
        className="back-link"
      >
        <ArrowLeft size={16} />
        Your seat selection
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ALMOST ON YOUR WAY</span>
          <h1>The people. The details. The journey.</h1>
          <p>
            Your seats: {hold.seatIds.join(", ")} · {trip?.from} → {trip?.to}
          </p>
        </div>
        <div className="hold-timer">
          <Clock3 size={18} />
          <strong>
            {Math.floor(remaining / 60)}:
            {String(remaining % 60).padStart(2, "0")}
          </strong>
          <span>remaining</span>
        </div>
      </div>
      {error && <ErrorBox message={error} />}
      {paymentOutcome?.startsWith("REFUND") ? (
        <div className="panel">
          <AlertCircle />
          <h2>Your hold expired before confirmation.</h2>
          <p>
            Payment status: {paymentOutcome.replaceAll("_", " ")}. Your refund
            is tracked in My journeys.
          </p>
          <Link className="button button-dark" to="/bookings">
            View status
          </Link>
        </div>
      ) : remaining === 0 ? (
        <div className="panel">
          <Clock3 />
          <h2>This seat hold has expired.</h2>
          <p>
            Your seats are available to other travellers. If a payment was
            captured, it will be reconciled and refunded.
          </p>
          <Link
            className="button button-dark"
            to={`/trip/${encodeURIComponent(hold.tripId)}`}
          >
            Choose seats again
          </Link>
        </div>
      ) : (
        <div className="checkout-layout">
          <section className="panel">
            <h2>Who’s coming along?</h2>
            <p className="muted">Enter each passenger’s details to continue.</p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                const form = new FormData(e.currentTarget);
                try {
                  const o = await api(`/holds/${id}/payment`, {
                    method: "POST",
                    body: JSON.stringify({
                      passengers: hold.seatIds.map((seatId, i) => ({
                        name: form.get(`name${i}`),
                        age: Number(form.get(`age${i}`)),
                        gender: hold.seatGenders?.[seatId],
                      })),
                      contact: form.get("contact"),
                    }),
                  });
                  setOrder(o);
                  await launch(o);
                  await refresh();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {hold.seatIds.map((s, i) => (
                <div className="passenger" key={s}>
                  <div className="passenger-label">
                    <span>{i + 1}</span>
                    <strong>Passenger {i + 1}</strong>
                    <small>Seat {s}</small>
                  </div>
                  <div className="field-row">
                    <label>
                      Full name
                      <input
                        name={`name${i}`}
                        required
                        minLength={2}
                        maxLength={80}
                        defaultValue={hold.passengers?.[i]?.name}
                        disabled={!!order}
                        placeholder="Passenger name"
                      />
                    </label>
                    <label className="age-field">
                      Age
                      <input
                        type="number"
                        name={`age${i}`}
                        required
                        min={1}
                        max={110}
                        defaultValue={hold.passengers?.[i]?.age}
                        disabled={!!order}
                        placeholder="Age"
                      />
                    </label>
                    <label className="gender-field">
                      Gender
                      <select
                        value={hold.seatGenders?.[s] ?? ""}
                        disabled
                        aria-label={`Gender for passenger in seat ${s}`}
                      >
                        <option value="FEMALE">Female</option>
                        <option value="MALE">Male</option>
                        <option value="OTHER">Other</option>
                      </select>
                    </label>
                  </div>
                </div>
              ))}
              <label>
                Contact number
                <input
                  name="contact"
                  type="tel"
                  pattern="\+?[0-9]{10,15}"
                  placeholder="10-digit mobile number"
                  defaultValue={hold.contact}
                  disabled={!!order}
                  required
                />
              </label>
              {!order && (
                <button className="button button-dark full" disabled={busy}>
                  {busy ? "Preparing your checkout…" : "Continue to payment"}
                  <ArrowRight size={18} />
                </button>
              )}
            </form>
            {order && (
              <div className="payment-panel">
                <span className="eyebrow">
                  {order.mode === "sandbox"
                    ? "SANDBOX PAYMENT"
                    : "SECURE CHECKOUT"}
                </span>
                <h3>
                  {order.mode === "sandbox"
                    ? "Try the complete booking experience."
                    : "Your payment is ready."}
                </h3>
                <p>
                  {order.mode === "sandbox"
                    ? "No money will be charged. This creates a demo ticket and exercises the same seat-confirmation rules."
                    : "Complete payment before the hold expires. Confirmation follows server verification."}
                </p>
                <button
                  className="button button-orange full"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      if (order.mode === "sandbox") {
                        const result = await api(`/holds/${id}/sandbox-pay`, {
                          method: "POST",
                        });
                        if (result.status === "CONFIRMED") nav(`/ticket/${id}`);
                        else {
                          notify(
                            "Hold expired. Your sandbox payment will be refunded.",
                          );
                          refresh();
                        }
                      } else await launch(order);
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy
                    ? "Confirming…"
                    : order.mode === "sandbox"
                      ? `Simulate payment · ${money(order.amount)}`
                      : "Open payment checkout"}
                  <ArrowRight size={17} />
                </button>
              </div>
            )}
          </section>
          <aside className="booking-summary">
            <span className="eyebrow">JOURNEY SUMMARY</span>
            <h2>{trip?.name}</h2>
            <p>
              {trip?.from} → {trip?.to}
            </p>
            <p>
              {trip && dateLabel(trip.date)} · {trip && time(trip.departureAt)}{" "}
              IST
            </p>
            <div className="summary-row">
              <span>Seats</span>
              <strong>{hold.seatIds.join(", ")}</strong>
            </div>
            <div className="summary-row">
              <span>Passengers</span>
              <strong>{hold.seatIds.length}</strong>
            </div>
            <div className="summary-total">
              <span>Total</span>
              <strong>{money(hold.amount)}</strong>
            </div>
            <div className="summary-note">
              <ShieldCheck size={20} />
              <p>
                Confirmation happens only after payment verification. Late
                payments become tracked refunds.
              </p>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
export function BookingsPage() {
  const { notify } = useApp();
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [cancelBusy, setCancelBusy] = useState("");
  const load = () =>
    api("/bookings")
      .then(setData)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="wrap page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">GOOD THINGS TO LOOK FORWARD TO</span>
          <h1>My journeys.</h1>
          <p>Your tickets and payment updates, right here.</p>
        </div>
        <Link to="/search" className="button button-dark">
          Plan another journey <ArrowRight size={17} />
        </Link>
      </div>
      {error ? (
        <ErrorBox message={error} retry={load} />
      ) : !data ? (
        <div className="loading">Finding your journeys…</div>
      ) : (
        <>
          {!data.bookings.length && !data.refunds.length ? (
            <div className="empty-state">
              <Ticket size={42} />
              <h2>Your story is still unfolding.</h2>
              <p>Once you book, your journey will appear here.</p>
              <Link to="/search" className="button button-dark">
                Find a bus <ArrowRight size={17} />
              </Link>
            </div>
          ) : (
            <div className="journey-grid">
              {data.bookings.map((b: any) => (
                <article className="journey-card" key={b._id}>
                  <div className="journey-card-top">
                    <span className={`status ${b.status === "CANCELLED" ? "" : "success"}`}>
                      {b.status === "CANCELLED" ? (
                        <XCircle size={14} />
                      ) : (
                        <Check size={14} />
                      )}
                      {b.status === "CANCELLED" ? "Cancelled" : "Confirmed"}
                    </span>
                    <small>{b.reference}</small>
                  </div>
                  <h2>
                    {b.trip.from} <ArrowRight size={20} />
                    {b.trip.to}
                  </h2>
                  <p>
                    {dateLabel(b.trip.departureAt)} · {time(b.trip.departureAt)}{" "}
                    IST
                  </p>
                  <div className="summary-row">
                    <span>
                      {b.trip.name} · Seats {b.seatIds.join(", ")}
                    </span>
                    <strong>{money(b.amount)}</strong>
                  </div>
                  {b.status === "CONFIRMED" && (
                    <div className="panel" style={{ marginTop: 14, padding: 14 }}>
                      <strong>Cancellation</strong>
                      <p className="muted small-text">
                        {b.cancellation?.allowed
                          ? `Cancel now for a ${b.cancellation.refundPercent}% refund (${money(b.cancellation.refundAmount)}).`
                          : b.cancellation?.reason ?? "Checking cancellation eligibility…"}
                      </p>
                      <button
                        className="button button-outline full"
                        disabled={cancelBusy === b._id}
                        onClick={async () => {
                          if (!b.cancellation?.allowed) {
                            notify(
                              b.cancellation?.reason ??
                                "This ticket is not eligible for cancellation.",
                            );
                            return;
                          }
                          const ok = window.confirm(
                            `Cancel booking ${b.reference}? Refund: ${money(b.cancellation.refundAmount)} (${b.cancellation.refundPercent}%). This cannot be undone.`,
                          );
                          if (!ok) return;
                          setCancelBusy(b._id);
                          try {
                            const result = await api(`/bookings/${b._id}/cancel`, {
                              method: "POST",
                            });
                            notify(
                              `Booking cancelled. Refund request ${money(result.refundAmount)} is awaiting admin approval.`,
                            );
                            await load();
                          } catch (e) {
                            notify((e as Error).message);
                            await load();
                          } finally {
                            setCancelBusy("");
                          }
                        }}
                      >
                        <XCircle size={17} />
                        {cancelBusy === b._id ? "Cancelling…" : "Cancel ticket"}
                      </button>
                    </div>
                  )}
                  <Link className="text-link" to={`/ticket/${b._id}`}>
                    {b.status === "CANCELLED" ? "View cancellation details" : "View your ticket"} <ArrowUpRightIcon />
                  </Link>
                </article>
              ))}
            </div>
          )}
          {data.refunds.length > 0 && (
            <section className="panel refund-section">
              <h2>Refund updates</h2>
              {data.refunds.map((r: any) => (
                <div className="summary-row" key={r._id}>
                  <div>
                    <strong>{money(r.amount)}</strong>
                    <p>
                      {r.mode === "sandbox" ? "Sandbox payment" : "Payment"} ·{" "}
                      {r.reason === "PASSENGER_CANCELLATION"
                        ? "Ticket cancellation"
                        : "Seat hold expired"}
                    </p>
                  </div>
                  <span className={`status ${r.status === "COMPLETED" ? "success" : ""}`}>
                    {refundStatusLabel(r)}
                  </span>
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
function refundStatusLabel(refund: any) {
  if (!refund) return "Refund status unavailable";
  switch (refund.status) {
    case "PENDING_APPROVAL":
      return "Awaiting admin approval";
    case "PENDING":
      return "Approved · Processing";
    case "SUBMITTED":
      return "Approved · Submitted";
    case "COMPLETED":
      return "Refunded";
    case "REJECTED":
      return "Refund rejected";
    case "UNKNOWN":
      return "Under review";
    default:
      return String(refund.status ?? "Refund pending").replaceAll("_", " ");
  }
}

function ArrowUpRightIcon() {
  return <ArrowRight size={17} />;
}
export function TicketPage() {
  const { id } = useParams();
  const { notify } = useApp();
  const [booking, setBooking] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = () =>
    api(`/bookings/${id}`)
      .then(setBooking)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, [id]);
  if (!booking)
    return (
      <div className="wrap page">
        {error ? (
          <ErrorBox message={error} />
        ) : (
          <div className="loading">Getting your ticket…</div>
        )}
      </div>
    );
  return (
    <div className="wrap page ticket-page">
      <div className="confirmation">
        <span className="confirmation-check">
          {booking.status === "CANCELLED" ? <XCircle size={32} /> : <Check size={32} />}
        </span>
        <span className="eyebrow">
          {booking.status === "CANCELLED" ? "BOOKING CANCELLED" : "YOUR SEAT IS SAVED"}
        </span>
        <h1>{booking.status === "CANCELLED" ? "Your journey was cancelled." : "You’re on your way."}</h1>
        <p>
          {booking.status === "CANCELLED"
            ? booking.refund?.status === "REJECTED"
              ? `Refund request declined: ${booking.refund.rejectionReason ?? "Please contact support for details."}`
              : `${booking.refundPercent}% refund request · ${money(booking.refundAmount ?? 0)} · ${refundStatusLabel(booking.refund)}.`
            : "Something good is waiting at the other end."}
        </p>
      </div>
      <article className="ticket">
        <div className="ticket-header">
          <span className="brand">
            <BusFront />
            <strong>HEAVEN—BUS</strong>
          </span>
          <span className={`status ${booking.status === "CANCELLED" ? "" : "success"}`}>
            {booking.status}
          </span>
        </div>
        <div className="ticket-body">
          <span className="eyebrow">{booking.trip.name}</span>
          <h2>
            {booking.trip.from} <ArrowRight />
            {booking.trip.to}
          </h2>
          <div className="ticket-details">
            <div>
              <small>DEPARTURE</small>
              <strong>{dateLabel(booking.trip.departureAt)}</strong>
              <span>{time(booking.trip.departureAt)} IST</span>
            </div>
            <div>
              <small>YOUR SEATS</small>
              <strong>{booking.seatIds.join(", ")}</strong>
              <span>{booking.passengers.length} passengers</span>
            </div>
            <div>
              <small>BOOKING REFERENCE</small>
              <strong>{booking.reference}</strong>
              <span>{money(booking.amount)} paid</span>
            </div>
          </div>
          <div className="ticket-passengers">
            {booking.passengers.map((p: any, i: number) => (
              <div key={i}>
                <span>
                  {p.name}, {p.age}
                  {p.gender ? ` · ${genderLabel(p.gender)}` : ""}
                </span>
                <strong>Seat {booking.seatIds[i]}</strong>
              </div>
            ))}
          </div>
        </div>
        <div className="ticket-stub">
          <ShieldCheck size={19} />
          <p>
            {booking.status === "CANCELLED"
              ? `Cancellation recorded. Refund: ${money(booking.refundAmount ?? 0)} (${booking.refundPercent ?? 0}%) · ${refundStatusLabel(booking.refund)}.`
              : <>Demo ticket · Not valid for travel.{" "}
                  {booking.paymentMode === "sandbox"
                    ? "No real money was charged."
                    : "Payment processed through the configured test provider."}</>}
          </p>
        </div>
      </article>
      {booking.status === "CONFIRMED" && (
        <section className="panel" style={{ marginTop: 20 }}>
          <h2>Cancellation policy</h2>
          <p className="muted">
            100% refund at least 24 hours before departure · 50% refund from 6–24 hours · cancellation closes inside 6 hours. Eligible refunds are submitted for administrator approval.
          </p>
          {booking.cancellation?.allowed ? (
            <>
              <p>
                If you cancel now, your refund will be <strong>{money(booking.cancellation.refundAmount)}</strong> ({booking.cancellation.refundPercent}%).
              </p>
              <button
                className="button button-outline"
                disabled={busy}
                onClick={async () => {
                  if (!booking.cancellation?.allowed) {
                    notify(
                      booking.cancellation?.reason ??
                        "This ticket is not eligible for cancellation.",
                    );
                    return;
                  }
                  const ok = window.confirm(
                    `Cancel this confirmed ticket? Refund: ${money(booking.cancellation.refundAmount)} (${booking.cancellation.refundPercent}%). This cannot be undone.`,
                  );
                  if (!ok) return;
                  setBusy(true);
                  try {
                    const result = await api(`/bookings/${id}/cancel`, { method: "POST" });
                    notify(`Booking cancelled. Refund request ${money(result.refundAmount)} is awaiting admin approval.`);
                    await load();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <XCircle size={17} />
                {busy ? "Cancelling…" : "Cancel confirmed ticket"}
              </button>
            </>
          ) : (
            <>
              <p className="muted">{booking.cancellation?.reason}</p>
              <button
                className="button button-outline"
                onClick={() =>
                  notify(
                    booking.cancellation?.reason ??
                      "This ticket is not eligible for cancellation.",
                  )
                }
              >
                <XCircle size={17} />
                Cancellation unavailable
              </button>
            </>
          )}
        </section>
      )}
      <div className="ticket-actions">
        {booking.status === "CONFIRMED" && (
          <button className="button button-dark" onClick={() => window.print()}>
            <Printer size={17} />
            Print ticket
          </button>
        )}
        <Link to="/bookings" className="button button-outline">
          My journeys <ArrowRight size={17} />
        </Link>
      </div>
    </div>
  );
}
