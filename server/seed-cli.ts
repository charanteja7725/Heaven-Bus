import "dotenv/config";
import { MongoClient } from "mongodb";
import { initialize } from "./db.js";
import { seed } from "./seed.js";
const client = new MongoClient(process.env.MONGODB_URI!);
await client.connect();
const s = {
  client,
  db: client.db(process.env.MONGODB_DB ?? "heaven_bus"),
  holdMs: 300000,
};
await initialize(s);
await seed(s);
await client.close();
console.log("Demo trips created for the next 14 days.");
