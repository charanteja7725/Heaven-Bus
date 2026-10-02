import "dotenv/config";
import { MongoClient } from "mongodb";
import { spawn } from "node:child_process";
import bcrypt from "bcryptjs";

const uri = process.env.SHOWCASE_MONGODB_URI ?? process.env.MONGODB_URI;
if (!uri) {
  throw new Error(
    "Visual showcase requires MONGODB_URI (or SHOWCASE_MONGODB_URI) in .env.",
  );
}
if (/mongodb:\/\/(?:127\.0\.0\.1|localhost)/i.test(uri)) {
  throw new Error(
    "Visual showcase is configured for local MongoDB. Set SHOWCASE_MONGODB_URI to your MongoDB Atlas URI so no local 600 MB MongoDB download is required.",
  );
}

const dbName = "heaven_bus_showcase";
const client = new MongoClient(uri, {
  serverSelectionTimeoutMS: 12000,
  maxPoolSize: 20,
});

console.log("Preparing isolated Atlas showcase database...");
await client.connect();
await client.db(dbName).dropDatabase();
await client
  .db(dbName)
  .collection("users")
  .insertOne({
    _id: "local-admin" as any,
    email: "admin@heaven.test",
    name: "Heaven Admin",
    password: await bcrypt.hash("Local-test-password-2026", 12),
    role: "admin",
  });
await client.close();
console.log("Showcase database ready.");

const child = spawn("node", ["--import", "tsx", "server/index.ts"], {
  stdio: "inherit",
  env: {
    ...process.env,
    MONGODB_URI: uri,
    MONGODB_DB: dbName,
    JWT_SECRET: "local-only-test-secret-at-least-32-characters",
    SEED_DEMO: "true",
    PAYMENT_MODE: "sandbox",
    FRONTEND_URL: "http://localhost:5173",
    PORT: "4000",
  },
});

async function stop() {
  child.kill("SIGTERM");
  process.exit(0);
}

process.on("SIGTERM", stop);
process.on("SIGINT", stop);
