import "dotenv/config";
import { MongoClient } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { setServers } from "node:dns";
import { spawn } from "node:child_process";
import bcrypt from "bcryptjs";

const showcase = process.env.PW_SHOWCASE === "1";
let repl: MongoMemoryReplSet | undefined;
let uri: string;

if (showcase) {
  const showcaseUri =
    process.env.SHOWCASE_MONGODB_URI ?? process.env.MONGODB_URI;

  if (!showcaseUri) {
    throw new Error(
      "Visual showcase requires SHOWCASE_MONGODB_URI. Run npm run showcase:configure.",
    );
  }
  if (/mongodb:\/\/(?:127\.0\.0\.1|localhost)/i.test(showcaseUri)) {
    throw new Error(
      "Visual showcase requires MongoDB Atlas rather than localhost.",
    );
  }

  uri = showcaseUri;
  if (uri.startsWith("mongodb+srv://")) {
    setServers(["8.8.8.8", "1.1.1.1"]);
    console.log("Atlas SRV lookup using public DNS fallback.");
  }
} else {
  console.log("Preparing isolated MongoDB memory replica set for automated E2E...");
  repl = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: "7.0.24" },
  });
  uri = repl.getUri();
}

const dbName = showcase ? "heaven_bus_showcase" : "heaven_bus_e2e";
const client = new MongoClient(uri, {
  serverSelectionTimeoutMS: showcase ? 12000 : 30000,
  maxPoolSize: 20,
});

console.log(
  showcase
    ? "Preparing isolated Atlas showcase database..."
    : "Preparing isolated E2E database...",
);
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
console.log("Showcase/E2E database ready.");

const child = spawn("node", ["--import", "tsx", "server/index.ts"], {
  stdio: "inherit",
  env: {
    ...process.env,
    MONGODB_URI: uri,
    MONGODB_DB: dbName,
    ...(showcase
      ? {
          MONGODB_DNS_SERVERS:
            process.env.SHOWCASE_DNS_SERVERS ?? "8.8.8.8,1.1.1.1",
        }
      : {}),
    JWT_SECRET: "local-only-test-secret-at-least-32-characters",
    SEED_DEMO: "true",
    PAYMENT_MODE: "sandbox",
    FRONTEND_URL: "http://localhost:5173",
    PORT: "4000",
  },
});

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  child.kill("SIGTERM");
  await repl?.stop();
  process.exit(0);
}

process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
