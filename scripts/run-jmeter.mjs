import dotenv from "dotenv";
import { mkdir, rm } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";

dotenv.config({ path: ".env.showcase", override: false });
dotenv.config({ override: false });

const mode = (process.argv[2] ?? "standard").toLowerCase();
const profiles = {
  quick: {
    healthUsers: 5,
    healthLoops: 2,
    healthRamp: 2,
    searchUsers: 3,
    searchLoops: 1,
    searchRamp: 3,
  },
  standard: {
    healthUsers: 50,
    healthLoops: 5,
    healthRamp: 10,
    searchUsers: 10,
    searchLoops: 3,
    searchRamp: 15,
  },
  stress: {
    healthUsers: 100,
    healthLoops: 8,
    healthRamp: 15,
    searchUsers: 20,
    searchLoops: 3,
    searchRamp: 20,
  },
};

if (!profiles[mode]) {
  console.error("\n✗ Unknown performance profile. Use quick, standard, or stress.\n");
  process.exit(1);
}

const profile = profiles[mode];
const uri = process.env.SHOWCASE_MONGODB_URI ?? process.env.MONGODB_URI;
if (!uri || /mongodb:\/\/(?:127\.0\.0\.1|localhost)/i.test(uri)) {
  console.error("\n✗ JMeter performance testing needs the Atlas showcase database.");
  console.error("Run: npm run showcase:configure\n");
  process.exit(1);
}

const check = spawnSync("jmeter", ["-v"], {
  shell: true,
  stdio: "ignore",
});
if (check.status !== 0) {
  console.error("\n✗ Apache JMeter was not found in PATH.");
  console.error("Install Apache JMeter + Java, add JMeter's bin folder to PATH, then reopen PowerShell.");
  console.error("Verify with: jmeter -v\n");
  process.exit(1);
}

try {
  const occupied = await fetch("http://127.0.0.1:4000/api/health/live", {
    signal: AbortSignal.timeout(1200),
  });
  if (occupied) {
    console.error("\n✗ Port 4000 is already serving a HEAVEN-BUS API.");
    console.error("Stop npm run dev:api / another showcase first so the performance run stays isolated.\n");
    process.exit(1);
  }
} catch {}

const resultsDir = "performance/results";
const reportDir = "performance/report";
const resultFile = `${resultsDir}/heaven-bus-${mode}.jtl`;
await mkdir(resultsDir, { recursive: true });
await rm(reportDir, { recursive: true, force: true });
await mkdir(reportDir, { recursive: true });
await rm(resultFile, { force: true });

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const server = spawn(npx, ["tsx", "tests/local-demo.ts"], {
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    PW_SHOWCASE: "1",
  },
});

server.stdout.on("data", (chunk) => process.stdout.write(`[SERVER] ${chunk}`));
server.stderr.on("data", (chunk) => process.stderr.write(`[SERVER] ${chunk}`));

async function waitForReady() {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch("http://127.0.0.1:4000/api/health/ready");
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Local performance-test API did not become ready.");
}

function stopServer() {
  if (!server.killed) server.kill("SIGTERM");
}

process.on("SIGINT", () => {
  stopServer();
  process.exit(130);
});
process.on("SIGTERM", () => {
  stopServer();
  process.exit(143);
});

try {
  console.log("\n========================================================================");
  console.log(`HEAVEN-BUS JMETER PERFORMANCE TEST — ${mode.toUpperCase()}`);
  console.log("========================================================================");
  console.log(`Health workload: ${profile.healthUsers} users × ${profile.healthLoops} loops`);
  console.log(`Search workload: ${profile.searchUsers} users × ${profile.searchLoops} loops`);
  console.log("Target: isolated local HEAVEN-BUS API backed by showcase Atlas DB");
  console.log("Preparing API...\n");

  await waitForReady();

  const jmeterArgs = [
    "-n",
    "-t",
    "performance/heaven-bus.jmx",
    "-l",
    resultFile,
    "-e",
    "-o",
    reportDir,
    "-Jprotocol=http",
    "-Jhost=127.0.0.1",
    "-Jport=4000",
    `-JhealthUsers=${profile.healthUsers}`,
    `-JhealthLoops=${profile.healthLoops}`,
    `-JhealthRamp=${profile.healthRamp}`,
    `-JsearchUsers=${profile.searchUsers}`,
    `-JsearchLoops=${profile.searchLoops}`,
    `-JsearchRamp=${profile.searchRamp}`,
  ];

  const jmeter = spawn("jmeter", jmeterArgs, {
    shell: true,
    stdio: "inherit",
  });

  const code = await new Promise((resolve) => jmeter.on("close", resolve));
  if (code !== 0) {
    console.error(`\n✗ JMeter exited with code ${code}.\n`);
    process.exitCode = Number(code) || 1;
  } else {
    const node = process.execPath;
    const checkResult = spawnSync(
      node,
      ["scripts/check-performance.mjs", resultFile, "performance/summary.json"],
      {
        stdio: "inherit",
        env: process.env,
      },
    );
    if (checkResult.status !== 0) process.exitCode = checkResult.status || 1;
  }
} finally {
  stopServer();
}
