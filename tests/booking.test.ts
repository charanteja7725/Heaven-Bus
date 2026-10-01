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
