import "dotenv/config";
import { MongoClient } from "mongodb";
const email = process.argv[2]?.toLowerCase();
if (!email) throw new Error("Usage: npm run admin -- your@email.com");
const client = new MongoClient(process.env.MONGODB_URI!);
await client.connect();
const r = await client
  .db(process.env.MONGODB_DB ?? "heaven_bus")
  .collection("users")
  .updateOne({ email }, { $set: { role: "admin" } });
console.log(
  r.matchedCount
    ? "Administrator access granted."
    : "No account found. Register the account first.",
);
await client.close();
