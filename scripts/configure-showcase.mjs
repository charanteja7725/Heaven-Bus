import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const rl = createInterface({ input, output });
try {
  console.log("\nHEAVEN-BUS visual showcase database setup");
  console.log("This stores the URI only in .env.showcase, which is ignored by Git.");
  console.log("Use a MongoDB Atlas connection string for a test/showcase-capable cluster.\n");

  const uri = (await rl.question("Paste MongoDB Atlas URI: ")).trim();

  if (!/^mongodb(?:\+srv)?:\/\//i.test(uri)) {
    throw new Error("That does not look like a MongoDB connection string.");
  }
  if (/mongodb:\/\/(?:127\.0\.0\.1|localhost)/i.test(uri)) {
    throw new Error("Use MongoDB Atlas, not localhost, for the visual showcase.");
  }

  await writeFile(
    ".env.showcase",
    [
      "# Local-only HEAVEN-BUS interview showcase settings",
      "# This file is ignored by Git and must never be committed.",
      `SHOWCASE_MONGODB_URI=${uri}`,
      "",
    ].join("\n"),
    "utf8",
  );

  console.log("\n✓ Saved .env.showcase locally.");
  console.log("Next run: npm run test:showcase\n");
} finally {
  rl.close();
}
