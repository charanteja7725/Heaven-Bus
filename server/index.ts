import "dotenv/config";
import { createServer } from "node:http";
import { MongoClient } from "mongodb";
import { Server } from "socket.io";
import { createApp, type Config } from "./app.js";
import { col, initialize, type Store } from "./db.js";
import { cleanup } from "./booking.js";
import { reconcile } from "./payments.js";
import { seed } from "./seed.js";
import {
  processBookingConfirmationEmails,
  processJourneyDayEmails,
} from "./notifications.js";
let store: Store | null = null;
const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 32)
  throw new Error("JWT_SECRET must contain at least 32 characters");
const config: Config = {
  secret,
  origins: (process.env.FRONTEND_URL ?? "http://localhost:5173")
    .split(",")
    .map((v) => v.trim()),
  payment: {
    mode: process.env.PAYMENT_MODE ?? "sandbox",
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
  },
};
if (!["sandbox", "razorpay"].includes(config.payment.mode))
  throw new Error("Invalid PAYMENT_MODE");
if (
  config.payment.mode === "razorpay" &&
  (!config.payment.keyId?.startsWith("rzp_test_") ||
    !config.payment.keySecret ||
    !config.payment.webhookSecret)
)
  throw new Error(
    "Razorpay Test Mode requires a test key ID, key secret and webhook secret",
  );
const emailConfig = {
  apiKey: process.env.RESEND_API_KEY,
  from: process.env.JOURNEY_EMAIL_FROM,
  gmailUser: process.env.GMAIL_USER,
  gmailAppPassword: process.env.GMAIL_APP_PASSWORD,
  gmailFromName: process.env.GMAIL_FROM_NAME,
  appUrl:
    process.env.PUBLIC_APP_URL?.trim() ||
    config.origins.find((origin) => origin.startsWith("https://")) ||
    config.origins[0] ||
    "http://localhost:5173",
};
console.log(
  emailConfig.gmailUser && emailConfig.gmailAppPassword
    ? "Email delivery provider ready: Gmail SMTP"
    : emailConfig.apiKey && emailConfig.from
      ? "Email delivery provider ready: Resend"
      : "Email delivery provider not configured",
);
const app = createApp(() => store, config),
  http = createServer(app);
const io = new Server(http, {
  cors: { origin: config.origins },
  allowRequest: (req, cb) =>
    cb(
      null,
      !req.headers.origin || config.origins.includes(req.headers.origin),
    ),
  transports: ["websocket"],
});
io.on("connection", (socket) => {
  let room: string | null = null;
  let requests = 0;
  const timer = setInterval(() => (requests = 0), 60000);
  socket.on("subscribe", (tripId: unknown) => {
    if (typeof tripId !== "string" || tripId.length > 180 || ++requests > 60)
      return;
    if (room) socket.leave(room);
    room = `trip:${tripId}`;
    socket.join(room);
    socket.emit("subscribed", tripId);
  });
  socket.on("disconnect", () => clearInterval(timer));
});
http.listen(Number(process.env.PORT ?? 4000), "0.0.0.0", () =>
  console.log("HEAVEN-BUS API listening"),
);

async function ensureBootstrapAdmin(s: Store) {
  const emails = [
    "admin@heavenbus.example",
    process.env.ADMIN_EMAIL?.trim().toLowerCase(),
  ].filter((value): value is string => Boolean(value));

  let promoted = 0;
  for (const email of emails) {
    const existing = await col(s, "users").findOne({ email });
    if (!existing) continue;
    if (existing.role !== "admin")
      await col(s, "users").updateOne(
        { _id: existing._id },
        { $set: { role: "admin" } },
      );
    promoted++;
  }

  console.log(
    promoted
      ? "Production administrator ready"
      : "Administrator bootstrap waiting for account registration",
  );
}

let connecting = false;
async function connect() {
  if (store || connecting || !process.env.MONGODB_URI) return;
  connecting = true;
  let client: MongoClient | undefined;
  let stage = "connect";
  try {
    console.log("MongoDB startup: connecting");
    client = new MongoClient(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 8000,
      maxPoolSize: 30,
    });
    await client.connect();
    stage = "indexes";
    console.log("MongoDB startup: connected; creating indexes");
    const candidate = {
      client,
      db: client.db(process.env.MONGODB_DB ?? "heaven_bus"),
      holdMs: 300000,
    };
    await initialize(candidate);
    if (process.env.SEED_DEMO === "true") {
      stage = "seed";
      console.log("MongoDB startup: preparing demo schedules");
      await seed(candidate);
    }
    stage = "admin-bootstrap";
    await ensureBootstrapAdmin(candidate);
    store = candidate;
    console.log("MongoDB ready");
  } catch (e) {
    const error = e as { name?: string; code?: unknown };
    console.error("MongoDB startup failed; retry scheduled", {
      stage,
      name: typeof error.name === "string" ? error.name : "UnknownError",
      code: typeof error.code === "number" ? error.code : undefined,
    });
    await client?.close();
  } finally {
    connecting = false;
  }
}
if (!process.env.MONGODB_URI)
  console.error("MongoDB setup required: MONGODB_URI is missing");
await connect();
let cleaning = false,
  publishing = false,
  reconciling = false,
  emailing = false,
  confirmationEmailing = false;
const timers = [
  setInterval(() => void connect(), 30000),
  setInterval(async () => {
    if (!store || cleaning) return;
    cleaning = true;
    try {
      await cleanup(store);
    } catch {
      console.error("Expiry recovery will retry");
    } finally {
      cleaning = false;
    }
  }, 1000),
  setInterval(async () => {
    if (!store || publishing) return;
    publishing = true;
    try {
      const records = await col(store, "outbox")
        .find({ sentAt: null })
        .limit(100)
        .toArray();
      for (const e of records) {
        io.to(`trip:${e.tripId}`).emit(
          e.kind === "TRACKING_CHANGED" ? "tracking:changed" : "seats:changed",
          {
            eventId: e._id,
            tripId: e.tripId,
          },
        );
        await col(store, "outbox").updateOne(
          { _id: e._id },
          { $set: { sentAt: new Date() } },
        );
      }
    } catch {
      console.error("Notification delivery will retry");
    } finally {
      publishing = false;
    }
  }, 400),
  setInterval(async () => {
    if (!store || confirmationEmailing) return;
    confirmationEmailing = true;
    try {
      await processBookingConfirmationEmails(store, emailConfig);
    } catch {
      console.error("Booking confirmation email delivery will retry");
    } finally {
      confirmationEmailing = false;
    }
  }, 10000),
  setInterval(async () => {
    if (!store || emailing) return;
    emailing = true;
    try {
      await processJourneyDayEmails(store, emailConfig);
    } catch {
      console.error("Journey email delivery will retry");
    } finally {
      emailing = false;
    }
  }, 5 * 60000),
  setInterval(async () => {
    if (!store || reconciling) return;
    reconciling = true;
    try {
      await reconcile(store, config.payment);
    } catch {
      console.error("Payment recovery will retry");
    } finally {
      reconciling = false;
    }
  }, 30000),
];
async function shutdown() {
  timers.forEach(clearInterval);
  io.close();
  http.close();
  await store?.client.close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
