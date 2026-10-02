import {
  beforeAll,
  afterAll,
  afterEach,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import request from "supertest";
import { initialize, col, type Store } from "../server/db";
import {
  selectSeats,
  startPayment,
  finalize,
  release,
  cleanup,
  snapshot,
  cancelBooking,
} from "../server/booking";
import { createApp } from "../server/app";
import { askJarvis } from "../server/jarvis";
import { createOrder, reconcile, validSignature } from "../server/payments";
import { createHmac } from "node:crypto";
import { seed } from "../server/seed";
import {
  getTripTracking,
  recordPassengerLocation,
  stopPassengerLocation,
} from "../server/tracking";
import {
  processBookingConfirmationEmails,
  processJourneyDayEmails,
} from "../server/notifications";
let repl: MongoMemoryReplSet, client: MongoClient, s: Store;
const tripId = "test-trip";
afterEach(() => vi.unstubAllGlobals());
beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: "7.0.24" },
  });
  client = new MongoClient(repl.getUri(), { maxPoolSize: 100 });
  await client.connect();
  s = { client, db: client.db("test"), holdMs: 300000 };
  await initialize(s);
}, 180000);
afterAll(async () => {
  await client?.close();
  await repl?.stop();
});
beforeEach(async () => {
  for (const name of [
    "users",
    "trips",
    "seats",
    "holds",
    "orders",
    "payments",
    "bookings",
    "refunds",
    "outbox",
    "inbox",
    "idempotency",
    "audit",
    "tracking",
    "passengerLocations",
    "emailNotifications",
  ])
    await col(s, name).deleteMany({});
  const departure = new Date(Date.now() + 86400000);
  await col(s, "trips").insertOne({
    _id: tripId,
    from: "Bengaluru",
    to: "Chennai",
    date: departure.toISOString().slice(0, 10),
    departureAt: departure,
    arrivalAt: new Date(departure.getTime() + 6 * 3600000),
    fare: 69900,
    status: "PUBLISHED",
    name: "Heaven Express",
    duration: 6,
  });
  await col(s, "seats").insertMany(
    ["1A", "1B", "1C", "1D"].map((seatId) => ({
      _id: seatId,
      tripId,
      seatId,
      state: "AVAILABLE",
      version: 0,
      holdId: null,
      expiresAt: null,
    })),
  );
});
async function prepare(user = "u1", seats = ["1A"]) {
  const { hold } = await selectSeats(s, user, tripId, seats, `key-${user}`);
  await startPayment(
    s,
    user,
    hold._id,
    seats.map(() => ({ name: "Test Passenger", age: 24 })),
    "9876543210",
    "sandbox",
  );
  return hold;
}
async function forceExpiry(id: string) {
  await col(s, "holds").updateOne(
    { _id: id },
    { $set: { expiresAt: new Date(0) } },
  );
  await col(s, "seats").updateMany(
    { holdId: id },
    { $set: { expiresAt: new Date(0) } },
  );
}
describe("database-enforced booking safety", () => {
  it("repairs interrupted seed inventory without resetting booked seats", async () => {
    const day = new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Kolkata",
    });
    const id = `Bengaluru-Chennai-${day}-0`;
    await col(s, "trips").insertOne({
      _id: id,
      demo: true,
      status: "PUBLISHED",
    });
    await col(s, "seats").insertOne({
      _id: `${id}:0`,
      tripId: id,
      seatId: "1A",
      state: "BOOKED",
      bookingId: "existing-booking",
    });
    await seed(s);
    expect(await col(s, "seats").countDocuments({ tripId: id })).toBe(40);
    expect(
      (await col(s, "seats").findOne({ tripId: id, seatId: "1A" }))!.state,
    ).toBe("BOOKED");
    expect(await col(s, "trips").countDocuments({ demo: true })).toBe(448);
  }, 60000);
  it("persists the passenger journey email through confirmation", async () => {
    const { hold } = await selectSeats(
      s,
      "email-user",
      tripId,
      ["1A"],
      "email-booking-key",
      { "1A": "FEMALE" },
    );
    await startPayment(
      s,
      "email-user",
      hold._id,
      [{ name: "Email Passenger", age: 28, gender: "FEMALE" }],
      "9876543210",
      "sandbox",
      "passenger@example.test",
    );
    const confirmed = await finalize(
      s,
      hold._id,
      "pay-email-booking",
      hold.amount,
      "INR",
    );
    expect(confirmed.booking.notificationEmail).toBe(
      "passenger@example.test",
    );
  });

  it("combines confirmed passenger GPS into the live bus position", async () => {
    const departure = new Date(Date.now() - 60 * 60 * 1000);
    const arrival = new Date(Date.now() + 5 * 60 * 60 * 1000);
    await col(s, "trips").updateOne(
      { _id: tripId },
      { $set: { departureAt: departure, arrivalAt: arrival, demo: false } },
    );
    const trip = {
      _id: tripId,
      name: "Heaven Express",
      from: "Bengaluru",
      to: "Chennai",
      departureAt: departure,
      arrivalAt: arrival,
    };
    await col(s, "bookings").insertMany([
      {
        _id: "gps-booking-1",
        holdId: "gps-hold-1",
        userId: "gps-user-1",
        status: "CONFIRMED",
        trip,
      },
      {
        _id: "gps-booking-2",
        holdId: "gps-hold-2",
        userId: "gps-user-2",
        status: "CONFIRMED",
        trip,
      },
    ]);

    await recordPassengerLocation(s, "gps-booking-1", "gps-user-1", {
      lat: 12.94,
      lng: 79.39,
      accuracy: 9,
      speedKph: 50,
    });
    await recordPassengerLocation(s, "gps-booking-2", "gps-user-2", {
      lat: 12.96,
      lng: 79.41,
      accuracy: 11,
      speedKph: 54,
    });

    let tracking = await getTripTracking(s, tripId);
    expect(tracking.source).toBe("PASSENGER_LIVE_GPS");
    expect(tracking.contributors).toBe(2);
    expect(tracking.location?.lat).toBeCloseTo(12.95, 5);
    expect(tracking.location?.lng).toBeCloseTo(79.4, 5);
    expect(tracking.location?.speedKph).toBe(52);

    await stopPassengerLocation(s, "gps-booking-1", "gps-user-1");
    tracking = await getTripTracking(s, tripId);
    expect(tracking.contributors).toBe(1);
    expect(
      await col(s, "passengerLocations").findOne({ _id: "gps-booking-1" }),
    ).toBeNull();
  });

  it("sends a confirmation email after ticket confirmation", async () => {
    const { hold } = await selectSeats(
      s,
      "confirm-email-user",
      tripId,
      ["1A"],
      "confirm-email-key",
      { "1A": "MALE" },
    );
    await startPayment(
      s,
      "confirm-email-user",
      hold._id,
      [{ name: "Confirmation Passenger", age: 24, gender: "MALE" }],
      "9876543210",
      "sandbox",
      "confirm@example.test",
    );
    const confirmed = await finalize(
      s,
      hold._id,
      "pay-confirm-email",
      hold.amount,
      "INR",
    );
    expect(confirmed.booking.confirmationEmailStatus).toBe("PENDING");

    const send = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "confirm-provider-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", send);

    const result = await processBookingConfirmationEmails(s, {
      apiKey: "test-email-key",
      from: "HEAVEN-BUS <journeys@example.test>",
      appUrl: "https://heaven-bus.example.test",
    });

    expect(result.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      (await col(s, "bookings").findOne({ _id: hold._id }))!
        .confirmationEmailStatus,
    ).toBe("SENT");
    expect(
      await col(s, "emailNotifications").findOne({
        _id: `booking-confirmation:${hold._id}`,
      }),
    ).toMatchObject({
      status: "SENT",
      type: "BOOKING_CONFIRMATION",
      email: "confirm@example.test",
    });
  });

  it("sends a journey-day email exactly once when provider is configured", async () => {
    const departure = new Date();
    departure.setMinutes(departure.getMinutes() + 30);
    const arrival = new Date(departure.getTime() + 6 * 3600000);
    const bookingId = "journey-email-booking";
    await col(s, "bookings").insertOne({
      _id: bookingId,
      holdId: bookingId,
      userId: "journey-email-user",
      status: "CONFIRMED",
      notificationEmail: "journey@example.test",
      reference: "HB-EMAIL01",
      seatIds: ["1A"],
      trip: {
        _id: tripId,
        name: "Heaven Express",
        from: "Bengaluru",
        to: "Chennai",
        departureAt: departure,
        arrivalAt: arrival,
      },
    });
    const send = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "email-provider-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", send);
    const config = {
      apiKey: "test-email-key",
      from: "HEAVEN-BUS <journeys@example.test>",
      appUrl: "https://heaven-bus.example.test",
    };
    const first = await processJourneyDayEmails(s, config);
    const second = await processJourneyDayEmails(s, config);
    expect(first.sent).toBe(1);
    expect(second.sent).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      (await col(s, "bookings").findOne({ _id: bookingId }))!
        .journeyDayEmailStatus,
    ).toBe("SENT");
  });

  it("500 simultaneous claimants produce exactly one owner", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 500 }, (_, i) =>
        selectSeats(s, `u${i}`, tripId, ["1A"], `burst-${i}`),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await col(s, "holds").countDocuments({ active: true })).toBe(1);
    expect(await col(s, "seats").countDocuments({ state: "HELD" })).toBe(1);
  }, 60000);
  it("rolls back a whole conflicting group", async () => {
    await selectSeats(s, "u1", tripId, ["1B"], "first-key");
    await expect(
      selectSeats(s, "u2", tripId, ["1A", "1B"], "second-key"),
    ).rejects.toThrow();
    expect((await col(s, "seats").findOne({ seatId: "1A" }))!.state).toBe(
      "AVAILABLE",
    );
  });
  it("reclaims expired seats with the cleanup worker stopped", async () => {
    const { hold } = await selectSeats(s, "u1", tripId, ["1A"], "first-key");
    await forceExpiry(hold._id);
    const next = await selectSeats(s, "u2", tripId, ["1A"], "second-key");
    expect(next.hold.userId).toBe("u2");
    await release(s, "u1", hold._id);
    expect((await col(s, "seats").findOne({ seatId: "1A" }))!.holdId).toBe(
      next.hold._id,
    );
  });
  it("never allows opposite genders to claim adjacent seats concurrently", async () => {
    const results = await Promise.allSettled([
      selectSeats(
        s,
        "female-user",
        tripId,
        ["1A"],
        "female-adjacent-key",
        { "1A": "FEMALE" },
      ),
      selectSeats(
        s,
        "male-user",
        tripId,
        ["1B"],
        "male-adjacent-key",
        { "1B": "MALE" },
      ),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await col(s, "holds").countDocuments({ active: true })).toBe(1);
  });

  it("marks a booked female seat and restricts its neighbour to the same gender", async () => {
    const { hold } = await selectSeats(
      s,
      "female-user",
      tripId,
      ["1A"],
      "female-booking-key",
      { "1A": "FEMALE" },
    );
    await startPayment(
      s,
      "female-user",
      hold._id,
      [{ name: "Female Passenger", age: 26, gender: "FEMALE" }],
      "9876543210",
      "sandbox",
    );
    await finalize(s, hold._id, "pay-female-seat", hold.amount, "INR");

    const femaleSeat = (await snapshot(s, tripId)).seats.find(
      (seat) => seat.seatId === "1A",
    );
    expect(femaleSeat?.state).toBe("BOOKED");
    expect(femaleSeat?.gender).toBe("FEMALE");

    await expect(
      selectSeats(
        s,
        "male-user",
        tripId,
        ["1B"],
        "male-next-to-female",
        { "1B": "MALE" },
      ),
    ).rejects.toThrow("female passenger");

    const sameGender = await selectSeats(
      s,
      "female-user-2",
      tripId,
      ["1B"],
      "female-next-to-female",
      { "1B": "FEMALE" },
    );
    expect(sameGender.hold.seatGenders["1B"]).toBe("FEMALE");
  });

  it("rejects mixed genders inside the same adjacent seat pair", async () => {
    await expect(
      selectSeats(
        s,
        "group-user",
        tripId,
        ["1C", "1D"],
        "mixed-pair-key",
        { "1C": "FEMALE", "1D": "MALE" },
      ),
    ).rejects.toThrow("Family booking");
    expect(await col(s, "holds").countDocuments({ active: true })).toBe(0);
  });

  it("allows mixed genders side by side inside the same family booking", async () => {
    const family = await selectSeats(
      s,
      "family-user",
      tripId,
      ["1A", "1B"],
      "family-pair-key",
      { "1A": "FEMALE", "1B": "MALE" },
      true,
    );
    expect(family.hold.familyBooking).toBe(true);
    expect(family.hold.seatGenders["1A"]).toBe("FEMALE");
    expect(family.hold.seatGenders["1B"]).toBe("MALE");

    await startPayment(
      s,
      "family-user",
      family.hold._id,
      [
        { name: "Family Member One", age: 30, gender: "FEMALE" },
        { name: "Family Member Two", age: 32, gender: "MALE" },
      ],
      "9876543210",
      "sandbox",
    );
    const confirmed = await finalize(
      s,
      family.hold._id,
      "pay-family-pair",
      family.hold.amount,
      "INR",
    );
    expect(confirmed.booking.familyBooking).toBe(true);
  });

  it("keeps the original deadline and replays idempotent selection", async () => {
    const first = await selectSeats(s, "u1", tripId, ["1A"], "first-key");
    const replay = await selectSeats(s, "u1", tripId, ["1A"], "first-key");
    expect(replay.hold._id).toBe(first.hold._id);
    const second = await selectSeats(
      s,
      "u1",
      tripId,
      ["1A", "1B"],
      "second-key",
    );
    expect(second.hold.expiresAt).toEqual(first.hold.expiresAt);
    await expect(
      selectSeats(s, "u1", tripId, ["1C"], "first-key"),
    ).rejects.toThrow("different selection");
  });
  it("deduplicates simultaneous payment confirmations", async () => {
    const h = await prepare();
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        finalize(s, h._id, "pay-one", h.amount, "INR"),
      ),
    );
    expect(results.every((r) => r.status === "CONFIRMED")).toBe(true);
    expect(await col(s, "bookings").countDocuments()).toBe(1);
    expect(await col(s, "payments").countDocuments()).toBe(1);
    expect((await col(s, "seats").findOne({ seatId: "1A" }))!.state).toBe(
      "BOOKED",
    );
  }, 30000);
  it("refunds a late payment without stealing the new hold", async () => {
    const h = await prepare();
    await forceExpiry(h._id);
    const next = await selectSeats(s, "u2", tripId, ["1A"], "new-owner");
    expect((await finalize(s, h._id, "pay-late", h.amount, "INR")).status).toBe(
      "REFUND_PENDING",
    );
    expect((await col(s, "seats").findOne({ seatId: "1A" }))!.holdId).toBe(
      next.hold._id,
    );
    await finalize(s, h._id, "pay-late", h.amount, "INR");
    expect(await col(s, "refunds").countDocuments()).toBe(1);
    await reconcile(s, { mode: "sandbox" });
    expect((await col(s, "refunds").findOne({ _id: "pay-late" }))!.status).toBe(
      "COMPLETED",
    );
  });
  it("returns expired inventory as available before cleanup", async () => {
    const { hold } = await selectSeats(s, "u1", tripId, ["1A"], "first-key");
    await forceExpiry(hold._id);
    expect(
      (await snapshot(s, tripId)).seats.find((x) => x.seatId === "1A")?.state,
    ).toBe("AVAILABLE");
    await cleanup(s);
    expect((await col(s, "holds").findOne({ _id: hold._id }))!.active).toBe(
      false,
    );
  });
  it("never partially confirms multiple seats", async () => {
    const h = await prepare("u1", ["1A", "1B"]);
    await col(s, "seats").updateOne(
      { seatId: "1B" },
      { $set: { holdId: "other" } },
    );
    const r = await finalize(s, h._id, "pay-group", h.amount, "INR");
    expect(r.status).toBe("REFUND_PENDING");
    expect(await col(s, "seats").countDocuments({ state: "BOOKED" })).toBe(0);
  });
  it("rejects a changed payment amount", async () => {
    const h = await prepare();
    await expect(finalize(s, h._id, "pay-bad", 1, "INR")).rejects.toThrow(
      "amount",
    );
    expect(await col(s, "bookings").countDocuments()).toBe(0);
  });
  it("refunds a second distinct captured payment for the same booking", async () => {
    const h = await prepare();
    await finalize(s, h._id, "pay-first", h.amount, "INR");
    expect(
      (await finalize(s, h._id, "pay-second", h.amount, "INR")).status,
    ).toBe("REFUND_PENDING");
    expect(await col(s, "bookings").countDocuments()).toBe(1);
    expect((await col(s, "seats").findOne({ seatId: "1A" }))!.state).toBe(
      "BOOKED",
    );
  });
  it("handles cleanup and finalization racing without duplicate allocation", async () => {
    const h = await prepare();
    await Promise.allSettled([
      cleanup(s),
      finalize(s, h._id, "pay-race", h.amount, "INR"),
      selectSeats(s, "u2", tripId, ["1A"], "race-other"),
    ]);
    expect(await col(s, "bookings").countDocuments()).toBe(1);
    expect((await col(s, "seats").findOne({ seatId: "1A" }))!.state).toBe(
      "BOOKED",
    );
  });
  it("cancels a confirmed ticket with the correct refund and releases the seat", async () => {
    const departure = new Date(Date.now() + 30 * 3600000);
    await col(s, "trips").updateOne(
      { _id: tripId },
      {
        $set: {
          departureAt: departure,
          arrivalAt: new Date(departure.getTime() + 6 * 3600000),
        },
      },
    );
    const h = await prepare();
    await finalize(s, h._id, "pay-cancel", h.amount, "INR");
    const result = await cancelBooking(s, "u1", h._id);
    expect(result.refundPercent).toBe(100);
    expect(result.refundAmount).toBe(h.amount);
    expect((await col(s, "bookings").findOne({ _id: h._id }))!.status).toBe(
      "CANCELLED",
    );
    expect((await col(s, "seats").findOne({ seatId: "1A" }))!.state).toBe(
      "AVAILABLE",
    );
    expect((await col(s, "refunds").findOne({ _id: "pay-cancel" }))!.amount).toBe(
      h.amount,
    );
  });

  it("uses a 50% cancellation refund from 6 to 24 hours and closes inside 6 hours", async () => {
    let departure = new Date(Date.now() + 12 * 3600000);
    await col(s, "trips").updateOne(
      { _id: tripId },
      {
        $set: {
          departureAt: departure,
          arrivalAt: new Date(departure.getTime() + 6 * 3600000),
        },
      },
    );
    const half = await prepare("u1", ["1A"]);
    await finalize(s, half._id, "pay-half", half.amount, "INR");
    expect((await cancelBooking(s, "u1", half._id)).refundPercent).toBe(50);

    await col(s, "bookings").deleteMany({});
    await col(s, "payments").deleteMany({});
    await col(s, "refunds").deleteMany({});
    await col(s, "holds").deleteMany({});
    await col(s, "orders").deleteMany({});
    await col(s, "seats").updateMany(
      { tripId },
      {
        $set: {
          state: "AVAILABLE",
          bookingId: null,
          holdId: null,
          expiresAt: null,
        },
      },
    );
    departure = new Date(Date.now() + 5 * 3600000);
    await col(s, "trips").updateOne(
      { _id: tripId },
      {
        $set: {
          departureAt: departure,
          arrivalAt: new Date(departure.getTime() + 6 * 3600000),
        },
      },
    );
    const late = await prepare("u2", ["1B"]);
    await finalize(s, late._id, "pay-late-cancel", late.amount, "INR");
    await expect(cancelBooking(s, "u2", late._id)).rejects.toThrow(
      "closes 6 hours",
    );
  });
});
describe("API and assistant", () => {
  const cfg = {
    secret: "test-only-secret-with-more-than-32-characters",
    origins: ["http://localhost:5173"],
    payment: { mode: "sandbox" },
  };
  it("requires auth and protects admin access", async () => {
    const app = createApp(() => s, cfg);
    expect(
      (
        await request(app)
          .post("/api/holds")
          .send({ tripId, seatIds: ["1A"] })
      ).status,
    ).toBe(401);
    const signup = await request(app).post("/api/auth/register").send({
      name: "Tester",
      email: "tester@example.test",
      password: "test-password-123",
    });
    expect(signup.status).toBe(200);
    expect(
      (
        await request(app)
          .get("/api/admin/overview")
          .set("Authorization", `Bearer ${signup.body.token}`)
      ).status,
    ).toBe(403);
  });
  it("holds passenger cancellation refunds for admin approval", async () => {
    const app = createApp(() => s, cfg);
    const signup = await request(app).post("/api/auth/register").send({
      name: "Cancel Tester",
      email: "cancel-api@example.test",
      password: "test-password-123",
    });
    const departure = new Date(Date.now() + 30 * 3600000);
    await col(s, "trips").updateOne(
      { _id: tripId },
      {
        $set: {
          departureAt: departure,
          arrivalAt: new Date(departure.getTime() + 6 * 3600000),
        },
      },
    );
    const h = await prepare(signup.body.user._id, ["1A"]);
    await finalize(s, h._id, "pay-api-cancel", h.amount, "INR");

    const result = await request(app)
      .post(`/api/bookings/${h._id}/cancel`)
      .set("Authorization", `Bearer ${signup.body.token}`);

    expect(result.status).toBe(200);
    expect(result.body.status).toBe("CANCELLED");
    expect(result.body.refundPercent).toBe(100);
    expect(result.body.refundStatus).toBe("PENDING_APPROVAL");
    expect((await col(s, "bookings").findOne({ _id: h._id }))!.status).toBe(
      "CANCELLED",
    );
    expect((await col(s, "refunds").findOne({ _id: "pay-api-cancel" }))!.status).toBe(
      "PENDING_APPROVAL",
    );

    await reconcile(s, cfg.payment);
    expect((await col(s, "refunds").findOne({ _id: "pay-api-cancel" }))!.status).toBe(
      "PENDING_APPROVAL",
    );

    const adminSignup = await request(app).post("/api/auth/register").send({
      name: "Refund Admin",
      email: "refund-admin@example.test",
      password: "test-password-123",
    });
    await col(s, "users").updateOne(
      { _id: adminSignup.body.user._id },
      { $set: { role: "admin" } },
    );

    const approved = await request(app)
      .post("/api/admin/refunds/pay-api-cancel/approve")
      .set("Authorization", `Bearer ${adminSignup.body.token}`);
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe("PENDING");

    await reconcile(s, cfg.payment);
    expect((await col(s, "refunds").findOne({ _id: "pay-api-cancel" }))!.status).toBe(
      "COMPLETED",
    );
  });

  it("lets an administrator reject a passenger refund with a reason", async () => {
    const app = createApp(() => s, cfg);
    const passenger = await request(app).post("/api/auth/register").send({
      name: "Passenger",
      email: "reject-passenger@example.test",
      password: "test-password-123",
    });
    const departure = new Date(Date.now() + 30 * 3600000);
    await col(s, "trips").updateOne(
      { _id: tripId },
      {
        $set: {
          departureAt: departure,
          arrivalAt: new Date(departure.getTime() + 6 * 3600000),
        },
      },
    );
    const h = await prepare(passenger.body.user._id, ["1B"]);
    await finalize(s, h._id, "pay-api-reject", h.amount, "INR");
    await request(app)
      .post(`/api/bookings/${h._id}/cancel`)
      .set("Authorization", `Bearer ${passenger.body.token}`);

    const adminSignup = await request(app).post("/api/auth/register").send({
      name: "Refund Admin",
      email: "reject-admin@example.test",
      password: "test-password-123",
    });
    await col(s, "users").updateOne(
      { _id: adminSignup.body.user._id },
      { $set: { role: "admin" } },
    );

    const rejected = await request(app)
      .post("/api/admin/refunds/pay-api-reject/reject")
      .set("Authorization", `Bearer ${adminSignup.body.token}`)
      .send({ reason: "Manual review declined this refund." });
    expect(rejected.status).toBe(200);
    const refund = await col(s, "refunds").findOne({ _id: "pay-api-reject" });
    expect(refund!.status).toBe("REJECTED");
    expect(refund!.rejectionReason).toContain("Manual review");
  });

  it("searches admin-created trips and exposes their locations publicly", async () => {
    const app = createApp(() => s, cfg);
    const signup = await request(app).post("/api/auth/register").send({
      name: "Trip Search Admin",
      email: "trip-search-admin@example.test",
      password: "test-password-123",
    });
    await col(s, "users").updateOne(
      { _id: signup.body.user._id },
      { $set: { role: "admin" } },
    );
    const token = signup.body.token;
    const departureAt = new Date(Date.now() + 3 * 86400000).toISOString();

    const created = await request(app)
      .post("/api/admin/trips")
      .set("Authorization", `Bearer ${token}`)
      .send({
        from: "Coimbatore Central Bus Stand",
        to: "Chennai Koyambedu",
        departureAt,
        duration: 7,
        fare: 85000,
        name: "Family Search Express",
      });
    expect(created.status).toBe(201);
    expect(created.body.source).toBe("ADMIN");

    const search = await request(app)
      .get("/api/admin/trips?q=Family%20Search")
      .set("Authorization", `Bearer ${token}`);
    expect(search.status).toBe(200);
    expect(search.body.some((trip: any) => trip._id === created.body._id)).toBe(
      true,
    );

    const locations = await request(app).get("/api/locations");
    expect(locations.status).toBe(200);
    expect(locations.body.locations).toContain("Coimbatore Central Bus Stand");
    expect(locations.body.locations).toContain("Chennai Koyambedu");
  });

  it("lets an administrator stop, resume and remove an unsold trip", async () => {
    const app = createApp(() => s, cfg);
    const signup = await request(app).post("/api/auth/register").send({
      name: "Admin Tester",
      email: "admin-api@example.test",
      password: "test-password-123",
    });
    await col(s, "users").updateOne(
      { _id: signup.body.user._id },
      { $set: { role: "admin" } },
    );
    const token = signup.body.token;

    const stopped = await request(app)
      .post(`/api/admin/trips/${tripId}/stop`)
      .set("Authorization", `Bearer ${token}`);
    expect(stopped.status).toBe(200);
    expect((await col(s, "trips").findOne({ _id: tripId }))!.status).toBe(
      "STOPPED",
    );

    const resumed = await request(app)
      .post(`/api/admin/trips/${tripId}/resume`)
      .set("Authorization", `Bearer ${token}`);
    expect(resumed.status).toBe(200);
    expect((await col(s, "trips").findOne({ _id: tripId }))!.status).toBe(
      "PUBLISHED",
    );

    const removed = await request(app)
      .delete(`/api/admin/trips/${tripId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(removed.status).toBe(200);
    expect(await col(s, "trips").findOne({ _id: tripId })).toBeNull();
    expect(await col(s, "seats").countDocuments({ tripId })).toBe(0);
  });
  it("does not accept a foreign reservation or forged webhook", async () => {
    const h = await prepare();
    const app = createApp(() => s, cfg);
    const u = await request(app).post("/api/auth/register").send({
      name: "Other",
      email: "other@example.test",
      password: "test-password-123",
    });
    expect(
      (
        await request(app)
          .get(`/api/holds/${h._id}`)
          .set("Authorization", `Bearer ${u.body.token}`)
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .post("/api/webhooks/razorpay")
          .send({ event: "payment.captured" })
      ).status,
    ).toBe(400);
  });
  it("validates webhook HMAC signatures without timing-unsafe comparison", () => {
    const payload = "{}",
      secret = "secret";
    const sig = createHmac("sha256", secret).update(payload).digest("hex");
    expect(validSignature(payload, sig, secret)).toBe(true);
    expect(validSignature(payload, "invalid", secret)).toBe(false);
  });
  it("searches real inventory by conversational route and budget", async () => {
    const date = (await col(s, "trips").findOne({ _id: tripId }))!.date;
    const r = await askJarvis(s, `Bengaluru to Chennai on ${date} under 800`);
    expect(r.trips).toHaveLength(1);
    expect(r.trips![0]._id).toBe(tripId);
    const cheaper = await askJarvis(s, "under 500", r.context);
    expect(cheaper.trips).toHaveLength(0);
  });
  it("understands reversed route wording, comma budgets and destination-first follow-ups", async () => {
    const date = (await col(s, "trips").findOne({ _id: tripId }))!.date;
    const r = await askJarvis(
      s,
      `A bus to Chennai from Bengaluru on ${date} under ₹1,000`,
    );
    expect(r.context).toMatchObject({
      from: "Bengaluru",
      to: "Chennai",
      maxFare: 100000,
    });
    expect(r.trips).toHaveLength(1);
    const destination = await askJarvis(s, `to Chennai on ${date}`);
    expect(destination.reply).toContain("travelling from");
    const followup = await askJarvis(
      s,
      "from Bangalore under 1k",
      destination.context,
    );
    expect(followup.trips).toHaveLength(1);
  });
  it("answers HEAVEN-BUS app FAQs and returns the right support numbers", async () => {
    const refund = await askJarvis(s, "What is the refund policy?");
    expect(refund.reply).toContain("100% refund");
    expect(refund.reply).toContain("6 to 24 hours");
    expect(refund.supportContacts?.[0].id).toBe("refunds");

    const family = await askJarvis(s, "How does family booking work?");
    expect(family.reply).toContain("Family booking");
    expect(family.reply).toContain("same reservation");

    const gps = await askJarvis(s, "How does live GPS tracking work?");
    expect(gps.reply).toContain("Use my current location");
    expect(gps.reply).toContain("passenger GPS");

    const email = await askJarvis(s, "Will I get a confirmation mail?");
    expect(email.reply).toContain("confirmation email");
    expect(email.reply).toContain("notification");

    const contact = await askJarvis(s, "Give me the customer care mobile number");
    expect(contact.supportContacts).toHaveLength(1);
    expect(contact.supportContacts?.[0].id).toBe("general");
    expect(contact.supportContacts?.[0].phone).toBe("1800-000-1099");

    const delayed = await askJarvis(s, "My bus is delayed, who should I call?");
    expect(delayed.supportContacts?.some((entry) => entry.id === "delay")).toBe(
      true,
    );
  });

  it("lets Jarvis read only the signed-in passenger's booking and refund status", async () => {
    const app = createApp(() => s, cfg);
    const first = await request(app).post("/api/auth/register").send({
      name: "Jarvis Passenger",
      email: "jarvis-passenger@example.test",
      password: "test-password-123",
    });
    const second = await request(app).post("/api/auth/register").send({
      name: "Other Passenger",
      email: "jarvis-other@example.test",
      password: "test-password-123",
    });

    await col(s, "bookings").insertOne({
      _id: "jarvis-booking",
      holdId: "jarvis-hold",
      userId: first.body.user._id,
      reference: "HB-JARVIS-123",
      status: "CONFIRMED",
      seatIds: ["1A"],
      trip: {
        _id: tripId,
        name: "Heaven Express",
        from: "Bengaluru",
        to: "Chennai",
      },
      createdAt: new Date(),
    });
    await col(s, "refunds").insertOne({
      _id: "jarvis-refund",
      holdId: "jarvis-hold",
      userId: first.body.user._id,
      amount: 69900,
      status: "PENDING_APPROVAL",
      createdAt: new Date(),
    });

    const booking = await request(app)
      .post("/api/jarvis")
      .set("Authorization", `Bearer ${first.body.token}`)
      .send({ message: "What is my latest booking?" });
    expect(booking.status).toBe(200);
    expect(booking.body.reply).toContain("HB-JARVIS-123");
    expect(booking.body.reply).toContain("Bengaluru");

    const refund = await request(app)
      .post("/api/jarvis")
      .set("Authorization", `Bearer ${first.body.token}`)
      .send({ message: "What is my refund status?" });
    expect(refund.status).toBe(200);
    expect(refund.body.reply).toContain("Pending Approval");
    expect(refund.body.reply).toContain("₹699");

    const privateResult = await request(app)
      .post("/api/jarvis")
      .set("Authorization", `Bearer ${second.body.token}`)
      .send({ message: "What is my latest booking?" });
    expect(privateResult.status).toBe(200);
    expect(privateResult.body.reply).not.toContain("HB-JARVIS-123");
    expect(privateResult.body.reply).toContain("do not have");
  });

  it("recovers the public checkout key after refresh without exposing provider secrets", async () => {
    const app = createApp(() => s, {
      ...cfg,
      payment: {
        mode: "razorpay",
        keyId: "rzp_test_public",
        keySecret: "private-provider-secret",
      },
    });
    const signup = await request(app).post("/api/auth/register").send({
      name: "Tester",
      email: "checkout@example.test",
      password: "test-password-123",
    });
    const { hold } = await selectSeats(
      s,
      signup.body.user._id,
      tripId,
      ["1A"],
      "checkout-key",
    );
    await startPayment(
      s,
      signup.body.user._id,
      hold._id,
      [{ name: "Tester", age: 24 }],
      "9876543210",
      "razorpay",
    );
    const result = await request(app)
      .get(`/api/holds/${hold._id}`)
      .set("Authorization", `Bearer ${signup.body.token}`);
    expect(result.body.order.keyId).toBe("rzp_test_public");
    expect(JSON.stringify(result.body)).not.toContain(
      "private-provider-secret",
    );
  });
  it("returns a truthful setup state without a database", async () => {
    const app = createApp(() => null, cfg);
    expect((await request(app).get("/api/health/live")).status).toBe(200);
    expect((await request(app).get("/api/health/ready")).status).toBe(503);
    expect((await request(app).get("/api/trips")).status).toBe(503);
  });
});

describe("provider timeout recovery", () => {
  const config = {
    mode: "razorpay",
    keyId: "rzp_test_key",
    keySecret: "test-secret",
  };
  const json = (value: unknown) =>
    new Response(JSON.stringify(value), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  it("recovers an unknown order without issuing another create request", async () => {
    const { hold } = await selectSeats(s, "u1", tripId, ["1A"], "recovery-key");
    const order = await startPayment(
      s,
      "u1",
      hold._id,
      [{ name: "Tester", age: 24 }],
      "9876543210",
      "razorpay",
    );
    const providerFetch = vi.fn(async (url: string, options: RequestInit) => {
      if (options.method === "POST")
        throw new Error("Response lost after provider created order");
      if (url.includes("orders?receipt="))
        return json({
          items: [
            { id: "order_recovered", receipt: hold._id, amount: hold.amount },
          ],
        });
      if (url.endsWith("/orders/order_recovered/payments"))
        return json({ items: [{ id: "pay_recovered", status: "captured" }] });
      if (url.endsWith("/payments/pay_recovered"))
        return json({
          id: "pay_recovered",
          order_id: "order_recovered",
          amount: hold.amount,
          currency: "INR",
          status: "captured",
        });
      throw new Error("Unexpected provider request");
    });
    vi.stubGlobal("fetch", providerFetch);
    expect((await createOrder(s, config, order))!.status).toBe(
      "CREATION_UNKNOWN",
    );
    await createOrder(s, config, order);
    await reconcile(s, config);
    expect(
      providerFetch.mock.calls.filter(
        ([, options]) => options.method === "POST",
      ),
    ).toHaveLength(1);
    expect(await col(s, "bookings").countDocuments()).toBe(1);
    expect((await col(s, "orders").findOne({ _id: hold._id }))!.status).toBe(
      "CAPTURED",
    );
  });

  it("recovers a timed-out refund and never resubmits the money movement", async () => {
    const hold = await prepare();
    await col(s, "orders").updateOne(
      { _id: hold._id },
      { $set: { mode: "razorpay", providerOrderId: "order_refund" } },
    );
    await forceExpiry(hold._id);
    await finalize(s, hold._id, "pay_refund", hold.amount, "INR");
    let remoteExists = false;
    const providerFetch = vi.fn(async (url: string, options: RequestInit) => {
      if (url.endsWith("/refund") && options.method === "POST") {
        remoteExists = true;
        throw new Error("Response lost");
      }
      if (url.endsWith("/payments/pay_refund/refunds"))
        return json({
          items: remoteExists
            ? [
                {
                  id: "rfnd_recovered",
                  status: "processed",
                  notes: { obligationId: "pay_refund" },
                },
              ]
            : [],
        });
      return json({ items: [] });
    });
    vi.stubGlobal("fetch", providerFetch);
    await reconcile(s, config);
    expect(
      (await col(s, "refunds").findOne({ _id: "pay_refund" }))!.status,
    ).toBe("UNKNOWN");
    await col(s, "refunds").updateOne(
      { _id: "pay_refund" },
      { $set: { nextAttemptAt: new Date(0) } },
    );
    await reconcile(s, config);
    expect(
      providerFetch.mock.calls.filter(
        ([, options]) => options.method === "POST",
      ),
    ).toHaveLength(1);
    expect(
      (await col(s, "refunds").findOne({ _id: "pay_refund" }))!.status,
    ).toBe("COMPLETED");
    expect(
      (await col(s, "payments").findOne({ providerId: "pay_refund" }))!.outcome,
    ).toBe("REFUNDED");
  });

  it("rotates recovery beyond the first batch of abandoned orders", async () => {
    await col(s, "orders").insertMany(
      Array.from({ length: 101 }, (_, i) => ({
        _id: `recovery-${i}`,
        mode: "razorpay",
        status: "READY",
        providerOrderId: `order_${i}`,
        createdAt: new Date(Date.now() + i),
      })),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ items: [] })),
    );
    await reconcile(s, config);
    expect(
      await col(s, "orders").countDocuments({
        lastCheckedAt: { $exists: true },
      }),
    ).toBe(100);
    await reconcile(s, config);
    expect(
      await col(s, "orders").countDocuments({
        lastCheckedAt: { $exists: true },
      }),
    ).toBe(101);
  });
});
