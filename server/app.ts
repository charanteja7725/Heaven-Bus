import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError, col, now, transaction, type Store } from "./db.js";
import {
  cancelBooking,
  cancellationQuote,
  finalize,
  release,
  selectSeats,
  snapshot,
  startPayment,
} from "./booking.js";
import {
  createOrder,
  validSignature,
  verifyPayment,
  type PaymentConfig,
} from "./payments.js";
import { askJarvis } from "./jarvis.js";
import { supportDirectory, supportDisclaimer } from "./support.js";
import {
  cityCoordinates,
  getTripTracking,
  recordPassengerLocation,
  stopPassengerLocation,
} from "./tracking.js";
export type Config = {
  secret: string;
  origins: string[];
  payment: PaymentConfig;
};
const seatIdSchema = z.string().regex(/^(?:[1-9]|10)[ABCD]$/);
const seatSchema = z
  .array(seatIdSchema)
  .max(6)
  .refine((x) => new Set(x).size === x.length);
const genderSchema = z.enum(["MALE", "FEMALE", "OTHER"]);
export function createApp(getStore: () => Store | null, c: Config) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, done) =>
        done(null, !origin || c.origins.includes(origin)),
    }),
  );
  app.get("/api/health/live", (_q, r) =>
    r.json({ status: "ok", service: "HEAVEN-BUS" }),
  );
  app.get("/api/health/ready", async (_q, r) => {
    try {
      const s = getStore();
      if (!s) throw Error();
      await s.db.command({ ping: 1 });
      r.json({ status: "ready", database: "connected" });
    } catch {
      r.status(503).json({
        status: "setup_required",
        message: "MongoDB connection is not configured or unavailable.",
      });
    }
  });
  app.get("/api/config", (_q, r) =>
    r.json({
      paymentMode: c.payment.mode,
      ready: !!getStore(),
      holdSeconds: 300,
    }),
  );
  app.post(
    "/api/webhooks/razorpay",
    express.raw({ type: "application/json", limit: "128kb" }),
    async (q, r, next) => {
      try {
        const s = getStore();
        if (!s) throw new AppError(503, "Database unavailable");
        if (
          !c.payment.webhookSecret ||
          !validSignature(
            q.body.toString(),
            q.header("x-razorpay-signature") ?? "",
            c.payment.webhookSecret,
          )
        )
          throw new AppError(400, "Invalid webhook signature");
        const eventId = q.header("x-razorpay-event-id");
        if (!eventId) throw new AppError(400, "Missing event ID");
        await col(s, "inbox").updateOne(
          { eventId },
          {
            $setOnInsert: {
              _id: randomUUID(),
              eventId,
              payload: JSON.parse(q.body.toString()),
              processedAt: null,
              createdAt: new Date(),
              attempts: 0,
            },
          },
          { upsert: true },
        );
        r.json({ ok: true });
      } catch (e) {
        next(e);
      }
    },
  );
  app.use(express.json({ limit: "32kb" }));
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 180,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );
  app.use("/api", (_q, r, next) => {
    r.set("Cache-Control", "no-store");
    if (!getStore())
      return next(
        new AppError(
          503,
          "Booking service is awaiting its MongoDB connection. Please try again later.",
          "DATABASE_UNAVAILABLE",
        ),
      );
    next();
  });
  const store = () => getStore()!;
  function tokenUser(q: express.Request) {
    const token = q.headers.authorization?.replace(/^Bearer /, "");
    if (!token) return null;
    try {
      return jwt.verify(token, c.secret) as { sub: string };
    } catch {
      return null;
    }
  }
  const auth: express.RequestHandler = async (q, r, next) => {
    try {
      const token = tokenUser(q);
      if (!token) throw new AppError(401, "Please sign in to continue");
      const user = await col(store(), "users").findOne(
        { _id: token.sub },
        { projection: { password: 0 } },
      );
      if (!user) throw new AppError(401, "Please sign in again");
      r.locals.user = user;
      next();
    } catch (e) {
      next(e);
    }
  };
  const admin: express.RequestHandler = (q, r, next) =>
    r.locals.user?.role === "admin"
      ? next()
      : next(new AppError(403, "Administrator access required"));
  const credentials = z.object({
    email: z
      .email()
      .max(200)
      .transform((v) => v.toLowerCase()),
    password: z.string().min(10).max(100),
    name: z.string().trim().min(2).max(80).optional(),
  });
  const authLimit = rateLimit({
    windowMs: 15 * 60000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.post("/api/auth/:action", authLimit, async (q, r) => {
    const { email, password, name } = credentials.parse(q.body);
    const action = String(q.params.action);
    if (!["login", "register"].includes(action))
      throw new AppError(404, "Not found");
    let u = await col(store(), "users").findOne({ email });
    if (action === "register") {
      if (u)
        throw new AppError(409, "An account with this email already exists.");
      if (!name) throw new AppError(400, "Your name is required");
      u = {
        _id: randomUUID(),
        email,
        password: await bcrypt.hash(password, 12),
        name,
        role: "passenger",
        createdAt: new Date(),
      };
      await col(store(), "users").insertOne(u);
    } else if (!u || !(await bcrypt.compare(password, u.password)))
      throw new AppError(401, "Email or password is incorrect");
    r.json({
      token: jwt.sign({ sub: u!._id }, c.secret, { expiresIn: "8h" }),
      user: { _id: u!._id, name: u!.name, email: u!.email, role: u!.role },
    });
  });
  app.get("/api/auth/me", auth, (_q, r) => r.json(r.locals.user));
  app.get("/api/support", (_q, r) =>
    r.json({ contacts: supportDirectory, disclaimer: supportDisclaimer }),
  );
  app.get("/api/locations", async (_q, r) => {
    const s = store();
    const filter = {
      status: "PUBLISHED",
      departureAt: { $gt: await now(s) },
    };
    const [from, to] = await Promise.all([
      col(s, "trips").distinct("from", filter),
      col(s, "trips").distinct("to", filter),
    ]);
    r.json({
      locations: [...new Set([...from, ...to])]
        .filter((value): value is string => typeof value === "string" && !!value.trim())
        .sort((a, b) => a.localeCompare(b)),
    });
  });
  app.get("/api/trips", async (q, r) => {
    const filter: any = {
      status: "PUBLISHED",
      departureAt: { $gt: await now(store()) },
    };
    for (const key of ["from", "to", "date"])
      if (typeof q.query[key] === "string") filter[key] = q.query[key];
    const trips = await col(store(), "trips")
      .find(filter)
      .sort({ departureAt: 1 })
      .limit(60)
      .toArray();
    const time = await now(store());
    r.json(
      await Promise.all(
        trips.map(async (t) => ({
          ...t,
          available: await col(store(), "seats").countDocuments({
            tripId: t._id,
            $or: [
              { state: "AVAILABLE" },
              { state: "HELD", expiresAt: { $lte: time } },
            ],
          }),
        })),
      ),
    );
  });
  app.get("/api/trips/:id", async (q, r) => {
    const t = await col(store(), "trips").findOne({ _id: String(q.params.id) });
    if (!t) throw new AppError(404, "Trip not found");
    r.json(t);
  });
  app.get("/api/trips/:id/seats", async (q, r) =>
    r.json(await snapshot(store(), String(q.params.id), tokenUser(q)?.sub)),
  );
  app.post("/api/holds", auth, async (q, r) => {
    const input = z
      .object({
        tripId: z.string().max(180),
        seatIds: seatSchema,
        seatGenders: z.record(seatIdSchema, genderSchema),
        familyBooking: z.boolean().default(false),
      })
      .superRefine((value, ctx) => {
        const keys = Object.keys(value.seatGenders);
        if (
          keys.length !== value.seatIds.length ||
          value.seatIds.some((seatId) => !value.seatGenders[seatId]) ||
          keys.some((seatId) => !value.seatIds.includes(seatId))
        )
          ctx.addIssue({
            code: "custom",
            message: "Choose a passenger gender for every selected seat.",
          });
      })
      .parse(q.body);
    const key = z.string().min(8).max(100).parse(q.header("Idempotency-Key"));
    r.json(
      await selectSeats(
        store(),
        r.locals.user._id,
        input.tripId,
        input.seatIds,
        key,
        input.seatGenders,
        input.familyBooking,
      ),
    );
  });
  app.get("/api/holds/current", auth, async (_q, r) =>
    r.json(
      await col(store(), "holds").findOne({
        userId: r.locals.user._id,
        active: true,
        $expr: { $gt: ["$expiresAt", "$$NOW"] },
      }),
    ),
  );
  app.get("/api/holds/:id", auth, async (q, r) => {
    const h = await col(store(), "holds").findOne({
      _id: String(q.params.id),
      userId: r.locals.user._id,
    });
    if (!h) throw new AppError(404, "Reservation not found");
    r.json({
      ...h,
      serverNow: await now(store()),
      order: ((order) =>
        order
          ? {
              ...order,
              keyId: order.mode === "razorpay" ? c.payment.keyId : undefined,
            }
          : null)(await col(store(), "orders").findOne({ _id: h._id })),
      payment: await col(store(), "payments").findOne({ holdId: h._id }),
      refunds: await col(store(), "refunds").find({ holdId: h._id }).toArray(),
    });
  });
  app.delete("/api/holds/:id", auth, async (q, r) =>
    r.json(await release(store(), r.locals.user._id, String(q.params.id))),
  );
  app.post("/api/holds/:id/payment", auth, async (q, r) => {
    const input = z
      .object({
        passengers: z
          .array(
            z.object({
              name: z.string().trim().min(2).max(80),
              age: z.number().int().min(1).max(110),
              gender: genderSchema,
            }),
          )
          .min(1)
          .max(6),
        contact: z.string().regex(/^\+?[0-9]{10,15}$/),
        notificationEmail: z
          .email()
          .max(200)
          .transform((value) => value.toLowerCase()),
      })
      .parse(q.body);
    const order = await startPayment(
      store(),
      r.locals.user._id,
      String(q.params.id),
      input.passengers,
      input.contact,
      c.payment.mode,
      input.notificationEmail,
    );
    const result = await createOrder(store(), c.payment, order);
    r.json({ ...result, keyId: c.payment.keyId });
  });
  app.post("/api/holds/:id/sandbox-pay", auth, async (q, r) => {
    if (c.payment.mode !== "sandbox") throw new AppError(404, "Not found");
    const o = await col(store(), "orders").findOne({
      _id: String(q.params.id),
      userId: r.locals.user._id,
      mode: "sandbox",
    });
    if (!o) throw new AppError(404, "Payment order not found");
    r.json(
      await finalize(
        store(),
        o._id,
        `sandbox_payment_${o._id}`,
        o.amount,
        o.currency,
      ),
    );
  });
  app.post("/api/holds/:id/verify", auth, async (q, r) => {
    const o = await col(store(), "orders").findOne({
      _id: String(q.params.id),
      userId: r.locals.user._id,
    });
    if (!o) throw new AppError(404, "Order not found");
    const input = z
      .object({
        paymentId: z.string().max(100),
        signature: z.string().max(100),
      })
      .parse(q.body);
    r.json(
      await verifyPayment(
        store(),
        c.payment,
        o._id,
        input.paymentId,
        input.signature,
      ),
    );
  });
  app.get("/api/bookings", auth, async (_q, r) => {
    const s = store();
    const bookings = await col(s, "bookings")
      .find({ userId: r.locals.user._id })
      .sort({ createdAt: -1 })
      .toArray();
    r.json({
      bookings: await Promise.all(
        bookings.map(async (booking) => ({
          ...booking,
          cancellation: await cancellationQuote(s, booking),
        })),
      ),
      refunds: await col(s, "refunds")
        .find({ userId: r.locals.user._id })
        .sort({ createdAt: -1 })
        .toArray(),
    });
  });
  app.get("/api/bookings/:id", auth, async (q, r) => {
    const s = store();
    const b = await col(s, "bookings").findOne({
      _id: String(q.params.id),
      userId: r.locals.user._id,
    });
    if (!b) throw new AppError(404, "Booking not found");
    r.json({
      ...b,
      cancellation: await cancellationQuote(s, b),
      refund: await col(s, "refunds").findOne({
        holdId: b.holdId,
        userId: r.locals.user._id,
      }),
    });
  });
  app.get("/api/bookings/:id/tracking", auth, async (q, r) => {
    const s = store();
    const booking = await col(s, "bookings").findOne({
      _id: String(q.params.id),
      userId: r.locals.user._id,
    });
    if (!booking) throw new AppError(404, "Booking not found");
    if (booking.status !== "CONFIRMED")
      throw new AppError(409, "Live tracking is available only for confirmed journeys.");
    r.json({
      booking: {
        _id: booking._id,
        reference: booking.reference,
        seatIds: booking.seatIds,
        notificationEmail: booking.notificationEmail ?? "",
      },
      tracking: await getTripTracking(s, booking.trip._id),
      support: supportDirectory,
      supportDisclaimer,
    });
  });

  app.post("/api/bookings/:id/location", auth, async (q, r) => {
    const input = z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        accuracy: z.number().nonnegative().max(5000).optional(),
        speedKph: z.number().nonnegative().max(250).optional(),
        heading: z.number().min(0).max(360).optional(),
      })
      .parse(q.body);
    r.json(
      await recordPassengerLocation(
        store(),
        String(q.params.id),
        r.locals.user._id,
        input,
      ),
    );
  });
  app.delete("/api/bookings/:id/location", auth, async (q, r) => {
    r.json(
      await stopPassengerLocation(
        store(),
        String(q.params.id),
        r.locals.user._id,
      ),
    );
  });

  app.post("/api/bookings/:id/cancel", auth, async (q, r) => {
    r.json(
      await cancelBooking(
        store(),
        r.locals.user._id,
        String(q.params.id),
      ),
    );
  });
  app.post(
    "/api/jarvis",
    rateLimit({ windowMs: 60000, limit: 30 }),
    async (q, r) => {
      const input = z
        .object({
          message: z.string().trim().min(1).max(800),
          context: z
            .object({
              from: z.string().max(50).optional(),
              to: z.string().max(50).optional(),
              date: z.string().max(12).optional(),
              maxFare: z.number().positive().optional(),
              night: z.boolean().optional(),
            })
            .optional(),
        })
        .parse(q.body);
      r.json(await askJarvis(store(), input.message, input.context));
    },
  );
  app.get("/api/admin/overview", auth, admin, async (_q, r) => {
    const s = store(),
      time = await now(s);
    const [users, bookings, holds, refunds, trips, orders] = await Promise.all([
      col(s, "users").countDocuments(),
      col(s, "bookings").find().sort({ createdAt: -1 }).limit(100).toArray(),
      col(s, "holds")
        .find({ active: true, expiresAt: { $gt: time } })
        .toArray(),
      col(s, "refunds").find().sort({ createdAt: -1 }).limit(100).toArray(),
      col(s, "trips")
        .find({ departureAt: { $gt: time } })
        .sort({ departureAt: 1 })
        .limit(60)
        .toArray(),
      col(s, "orders")
        .find({ status: { $in: ["CREATION_UNKNOWN", "CREATION_IN_PROGRESS"] } })
        .limit(100)
        .toArray(),
    ]);
    const totals = await col(s, "bookings")
      .aggregate([
        { $match: { status: "CONFIRMED" } },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            revenue: { $sum: "$amount" },
          },
        },
      ])
      .next();
    const refundDetails = await Promise.all(
      refunds.map(async (refund: any) => {
        const [booking, traveller] = await Promise.all([
          col(s, "bookings").findOne({ holdId: refund.holdId }),
          col(s, "users").findOne({ _id: refund.userId }),
        ]);
        return {
          ...refund,
          booking: booking
            ? {
                reference: booking.reference,
                trip: booking.trip,
                seatIds: booking.seatIds,
              }
            : null,
          traveller: traveller
            ? { name: traveller.name, email: traveller.email }
            : null,
        };
      }),
    );
    r.json({
      users,
      bookings,
      holds,
      refunds: refundDetails,
      trips,
      orders,
      totals: totals ?? { count: 0, revenue: 0 },
      serverNow: time,
    });
  });
  app.post("/api/admin/refunds/:id/approve", auth, admin, async (q, r) => {
    r.json(
      await sReviewRefund(
        store(),
        String(q.params.id),
        "APPROVE",
        r.locals.user._id,
      ),
    );
  });
  app.post("/api/admin/refunds/:id/reject", auth, admin, async (q, r) => {
    const input = z
      .object({
        reason: z.string().trim().min(3).max(200),
      })
      .parse(q.body);
    r.json(
      await sReviewRefund(
        store(),
        String(q.params.id),
        "REJECT",
        r.locals.user._id,
        input.reason,
      ),
    );
  });
  app.get("/api/admin/trips", auth, admin, async (q, r) => {
    const s = store();
    const time = await now(s);
    const search =
      typeof q.query.q === "string" ? q.query.q.trim().slice(0, 80) : "";
    const status =
      typeof q.query.status === "string" ? q.query.status.trim() : "";
    const filter: any = { departureAt: { $gt: time } };

    if (status === "PUBLISHED" || status === "STOPPED") filter.status = status;
    if (search) {
      const safe = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { name: { $regex: safe, $options: "i" } },
        { from: { $regex: safe, $options: "i" } },
        { to: { $regex: safe, $options: "i" } },
      ];
    }

    r.json(
      await col(s, "trips")
        .find(filter)
        .sort({ createdAt: -1, departureAt: 1 })
        .limit(250)
        .toArray(),
    );
  });
  app.post("/api/admin/trips", auth, admin, async (q, r) => {
    const input = z
      .object({
        from: z.string().trim().min(2).max(50),
        to: z.string().trim().min(2).max(50),
        departureAt: z.iso.datetime(),
        duration: z.number().positive().max(48),
        fare: z.number().int().min(10000).max(10000000),
        name: z.string().trim().min(2).max(80),
      })
      .parse(q.body);
    if (input.from === input.to || new Date(input.departureAt) <= new Date())
      throw new AppError(400, "Choose different cities and a future departure");
    const id = randomUUID(),
      trip = {
        _id: id,
        ...input,
        departureAt: new Date(input.departureAt),
        arrivalAt: new Date(
          new Date(input.departureAt).getTime() + input.duration * 3600000,
        ),
        date: new Date(new Date(input.departureAt).getTime() + 19800000)
          .toISOString()
          .slice(0, 10),
        status: "PUBLISHED",
        type: "AC Seater",
        seats: 40,
        amenities: ["Air conditioning", "Charging port"],
        originLocation: cityCoordinates[input.from] ?? null,
        destinationLocation: cityCoordinates[input.to] ?? null,
        demo: true,
        source: "ADMIN",
        createdBy: r.locals.user._id,
        createdAt: new Date(),
      };
    await sCreateTrip(store(), trip, r.locals.user._id);
    r.status(201).json(trip);
  });
  app.post("/api/admin/trips/:id/stop", auth, admin, async (q, r) => {
    r.json(
      await sSetTripStatus(
        store(),
        String(q.params.id),
        "STOPPED",
        r.locals.user._id,
      ),
    );
  });
  app.post("/api/admin/trips/:id/resume", auth, admin, async (q, r) => {
    r.json(
      await sSetTripStatus(
        store(),
        String(q.params.id),
        "PUBLISHED",
        r.locals.user._id,
      ),
    );
  });
  app.delete("/api/admin/trips/:id", auth, admin, async (q, r) => {
    r.json(
      await sRemoveTrip(
        store(),
        String(q.params.id),
        r.locals.user._id,
      ),
    );
  });
  app.use(
    (
      e: any,
      _q: express.Request,
      r: express.Response,
      _next: express.NextFunction,
    ) => {
      const status =
        e instanceof z.ZodError
          ? 400
          : e.code === 11000
            ? 409
            : (e.status ?? 500);
      const message =
        e instanceof z.ZodError
          ? e.issues[0].message
          : e.code === 11000
            ? "This action conflicts with another request. Please refresh and retry."
            : status === 500
              ? "The request could not be completed. Please try again."
              : e.message;
      if (status >= 500)
        console.error("request_error", e.name, e.code ?? "", e.status ?? "");
      r.status(status).json({
        message,
        code: e instanceof AppError ? e.code : "REQUEST_FAILED",
      });
    },
  );
  return app;
}
async function sCreateTrip(s: Store, trip: any, actor: string) {
  const session = s.client.startSession();
  try {
    await session.withTransaction(async () => {
      await col(s, "trips").insertOne(trip, { session });
      await col(s, "seats").insertMany(
        Array.from({ length: 40 }, (_, i) => ({
          _id: `${trip._id}:${i}`,
          tripId: trip._id,
          seatId: `${Math.floor(i / 4) + 1}${"ABCD"[i % 4]}`,
          state: "AVAILABLE",
          version: 0,
          holdId: null,
          expiresAt: null,
        })),
        { session },
      );
      await col(s, "audit").insertOne(
        {
          _id: randomUUID(),
          actor,
          action: "CREATE_TRIP",
          tripId: trip._id,
          createdAt: new Date(),
        },
        { session },
      );
    });
  } finally {
    await session.endSession();
  }
}

async function sSetTripStatus(
  s: Store,
  tripId: string,
  status: "PUBLISHED" | "STOPPED",
  actor: string,
) {
  const session = s.client.startSession();
  try {
    return await session.withTransaction(async () => {
      const trip = await col(s, "trips").findOne({ _id: tripId }, { session });
      if (!trip) throw new AppError(404, "Trip not found");
      const time = await now(s, session);
      if (new Date(trip.departureAt) <= time)
        throw new AppError(409, "This departure has already started.");

      if (status === "STOPPED") {
        const activeHolds = await col(s, "holds")
          .find({ tripId, active: true }, { session })
          .toArray();
        if (activeHolds.length) {
          await col(s, "holds").updateMany(
            { tripId, active: true },
            { $set: { active: false, state: "TRIP_STOPPED" } },
            { session },
          );
          await col(s, "seats").updateMany(
            { tripId, state: "HELD" },
            {
              $set: {
                state: "AVAILABLE",
                holdId: null,
                expiresAt: null,
                gender: null,
              },
              $inc: { version: 1 },
            },
            { session },
          );
        }
      }

      await col(s, "trips").updateOne(
        { _id: tripId },
        {
          $set: {
            status,
            ...(status === "STOPPED"
              ? { stoppedAt: time, stoppedBy: actor }
              : { resumedAt: time, resumedBy: actor }),
          },
        },
        { session },
      );

      await col(s, "outbox").insertOne(
        {
          _id: randomUUID(),
          tripId,
          createdAt: time,
          sentAt: null,
        },
        { session },
      );
      await col(s, "audit").insertOne(
        {
          _id: randomUUID(),
          actor,
          action: status === "STOPPED" ? "STOP_TRIP" : "RESUME_TRIP",
          tripId,
          createdAt: time,
        },
        { session },
      );
      return { ok: true, status };
    });
  } finally {
    await session.endSession();
  }
}

async function sRemoveTrip(s: Store, tripId: string, actor: string) {
  const session = s.client.startSession();
  try {
    return await session.withTransaction(async () => {
      const trip = await col(s, "trips").findOne({ _id: tripId }, { session });
      if (!trip) throw new AppError(404, "Trip not found");

      const [bookings, holds, riskyOrders] = await Promise.all([
        col(s, "bookings").countDocuments(
          { "trip._id": tripId, status: "CONFIRMED" },
          { session },
        ),
        col(s, "holds").countDocuments({ tripId, active: true }, { session }),
        col(s, "orders").countDocuments(
          {
            _id: {
              $in: (
                await col(s, "holds")
                  .find({ tripId }, { session, projection: { _id: 1 } })
                  .toArray()
              ).map((h) => h._id),
            },
            status: {
              $in: ["CREATING", "CREATION_IN_PROGRESS", "CREATION_UNKNOWN", "READY"],
            },
          },
          { session },
        ),
      ]);

      if (bookings)
        throw new AppError(
          409,
          "This trip has confirmed tickets. Stop sales instead of removing it.",
          "TRIP_HAS_BOOKINGS",
        );
      if (holds || riskyOrders)
        throw new AppError(
          409,
          "This trip still has active reservations or payment activity. Stop sales first and try again after they clear.",
          "TRIP_BUSY",
        );

      await col(s, "seats").deleteMany({ tripId }, { session });
      await col(s, "trips").deleteOne({ _id: tripId }, { session });
      await col(s, "audit").insertOne(
        {
          _id: randomUUID(),
          actor,
          action: "REMOVE_TRIP",
          tripId,
          trip: {
            from: trip.from,
            to: trip.to,
            departureAt: trip.departureAt,
            name: trip.name,
          },
          createdAt: new Date(),
        },
        { session },
      );
      return { ok: true, removed: true };
    });
  } finally {
    await session.endSession();
  }
}

async function sReviewRefund(
  s: Store,
  refundId: string,
  decision: "APPROVE" | "REJECT",
  actor: string,
  rejectionReason?: string,
) {
  return transaction(s, async (session) => {
    const refund = await col(s, "refunds").findOne(
      { _id: refundId },
      { session },
    );
    if (!refund) throw new AppError(404, "Refund request not found");
    if (refund.reason !== "PASSENGER_CANCELLATION")
      throw new AppError(
        409,
        "This is a payment-safety refund and is handled automatically.",
        "AUTOMATIC_REFUND",
      );

    const time = await now(s, session);

    if (decision === "APPROVE") {
      if (!["PENDING_APPROVAL", "REJECTED"].includes(refund.status))
        throw new AppError(
          409,
          "This refund is already approved or being processed.",
          "REFUND_ALREADY_PROCESSING",
        );

      await col(s, "refunds").updateOne(
        { _id: refundId },
        {
          $set: {
            status: "PENDING",
            approvedAt: time,
            approvedBy: actor,
            nextAttemptAt: time,
            leaseUntil: new Date(0),
          },
          $unset: {
            rejectedAt: "",
            rejectedBy: "",
            rejectionReason: "",
          },
        },
        { session },
      );
      await col(s, "payments").updateOne(
        { providerId: refundId },
        { $set: { outcome: "REFUND_PENDING" } },
        { session },
      );
    } else {
      if (refund.status !== "PENDING_APPROVAL")
        throw new AppError(
          409,
          "Only refunds awaiting approval can be rejected.",
          "REFUND_NOT_AWAITING_APPROVAL",
        );

      await col(s, "refunds").updateOne(
        { _id: refundId },
        {
          $set: {
            status: "REJECTED",
            rejectedAt: time,
            rejectedBy: actor,
            rejectionReason,
            leaseUntil: new Date(0),
          },
        },
        { session },
      );
      await col(s, "payments").updateOne(
        { providerId: refundId },
        { $set: { outcome: "REFUND_REJECTED" } },
        { session },
      );
    }

    await col(s, "audit").insertOne(
      {
        _id: randomUUID(),
        actor,
        action:
          decision === "APPROVE" ? "APPROVE_REFUND" : "REJECT_REFUND",
        refundId,
        holdId: refund.holdId,
        amount: refund.amount,
        reason: rejectionReason ?? null,
        createdAt: time,
      },
      { session },
    );

    return {
      ok: true,
      status: decision === "APPROVE" ? "PENDING" : "REJECTED",
      refundId,
    };
  });
}
