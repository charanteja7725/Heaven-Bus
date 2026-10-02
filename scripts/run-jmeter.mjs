import dotenv from "dotenv";
import { mkdir, rm } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";

dotenv.config({ path: ".env.showcase", override: false });
dotenv.config({ override: false });

const uri = process.env.SHOWCASE_MONGODB_URI ?? process.env.MONGODB_URI;
if (
  !uri ||
  /mongodb:\/\/(?:127\.0\.0\.1|localhost)/i.test(uri)
) {
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
  console.error("Install Apache JMeter, ensure Java is installed, and add JMeter's bin folder to PATH.");
  console.error("Then run: npm run test:performance\n");
  process.exit(1);
}

const resultsDir = "performance/results";
const reportDir = "performance/report";
await mkdir(resultsDir, { recursive: true });
await rm(reportDir, { recursive: true, force: true });
await mkdir(reportDir, { recursive: true });

const server = spawn("npx", ["tsx", "tests/local-demo.ts"], {
  shell: true,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    PW_SHOWCASE: "1",
  },
});

server.stdout.on("data", (chunk) => process.stdout.write(`[SERVER] ${chunk}`));
server.stderr.on("data", (chunk) => process.stderr.write(`[SERVER] ${chunk}`));

async function waitForReady() {
  const deadline = Date.now() + 90000;
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
  console.log("\nPreparing isolated HEAVEN-BUS API for Apache JMeter...");
  await waitForReady();

  console.log("\nRunning non-functional performance tests with Apache JMeter...");
  console.log("Workload: public health throughput + rate-limit-safe booking search traffic.");
  console.log("HTML dashboard: performance/report/index.html\n");

  const jmeter = spawn(
    "jmeter",
    [
      "-n",
      "-t",
      "performance/heaven-bus.jmx",
      "-l",
      "performance/results/heaven-bus.jtl",
      "-e",
      "-o",
      "performance/report",
      "-Jprotocol=http",
      "-Jhost=127.0.0.1",
      "-Jport=4000",
    ],
    { shell: true, stdio: "inherit" },
  );

  const code = await new Promise((resolve) => jmeter.on("close", resolve));
  if (code !== 0) {
    console.error(`\n✗ JMeter exited with code ${code}.\n`);
    process.exitCode = Number(code) || 1;
  } else {
    console.log("\n✓ JMeter performance run completed.");
    console.log("Open performance/report/index.html for response time, throughput and error-rate charts.\n");
  }
} finally {
  stopServer();
}
