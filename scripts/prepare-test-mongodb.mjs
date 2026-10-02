import { MongoMemoryReplSet } from "mongodb-memory-server";

console.log("Preparing MongoDB 7.0.24 for the local isolated test environment...");
console.log("The first run may download about 600 MB. Later runs reuse the cached binary.");

const repl = await MongoMemoryReplSet.create({
  replSet: { count: 1 },
  binary: { version: "7.0.24" },
});

console.log("MongoDB test runtime is ready and cached.");
await repl.stop();
