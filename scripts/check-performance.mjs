import { readFile, writeFile } from "node:fs/promises";

const resultFile = process.argv[2] ?? "performance/results/heaven-bus.jtl";
const summaryFile = process.argv[3] ?? "performance/summary.json";

function parseCsvLine(line) {
  const out = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      out.push(value);
      value = "";
    } else {
      value += char;
    }
  }
  out.push(value);
  return out;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

const raw = await readFile(resultFile, "utf8");
const lines = raw.trim().split(/\r?\n/).filter(Boolean);
if (lines.length < 2) {
  console.error("✗ JMeter result file contains no samples.");
  process.exit(1);
}

const headers = parseCsvLine(lines[0]);
const rows = lines.slice(1).map((line) => {
  const values = parseCsvLine(line);
  return Object.fromEntries(headers.map((header, i) => [header, values[i] ?? ""]));
});

const samples = rows.map((row) => ({
  timestamp: Number(row.timeStamp),
  elapsed: Number(row.elapsed),
  latency: Number(row.Latency),
  connect: Number(row.Connect),
  label: row.label || "unknown",
  code: row.responseCode,
  success: String(row.success).toLowerCase() === "true",
}));

const elapsedValues = samples.map((sample) => sample.elapsed).filter(Number.isFinite);
const failures = samples.filter((sample) => !sample.success);
const timestamps = samples.map((sample) => sample.timestamp).filter(Number.isFinite);
const startedAt = Math.min(...timestamps);
const endedAt = Math.max(
  ...samples.map((sample) => sample.timestamp + Math.max(0, sample.elapsed)),
);
const durationSeconds = Math.max(0.001, (endedAt - startedAt) / 1000);

function statsFor(group) {
  const times = group.map((sample) => sample.elapsed).filter(Number.isFinite);
  const groupFailures = group.filter((sample) => !sample.success).length;
  return {
    samples: group.length,
    errors: groupFailures,
    errorPct: group.length ? (groupFailures / group.length) * 100 : 0,
    avgMs: group.length
      ? times.reduce((sum, value) => sum + value, 0) / times.length
      : 0,
    p90Ms: percentile(times, 90),
    p95Ms: percentile(times, 95),
    p99Ms: percentile(times, 99),
    maxMs: times.length ? Math.max(...times) : 0,
  };
}

const labels = {};
for (const label of [...new Set(samples.map((sample) => sample.label))]) {
  labels[label] = statsFor(samples.filter((sample) => sample.label === label));
}

const overall = {
  ...statsFor(samples),
  throughputRps: samples.length / durationSeconds,
  durationSeconds,
};

const thresholds = {
  maxErrorPct: Number(process.env.PERF_MAX_ERROR_PCT ?? 1),
  maxP95Ms: Number(process.env.PERF_MAX_P95_MS ?? 2500),
  maxAvgMs: Number(process.env.PERF_MAX_AVG_MS ?? 1500),
};

const checks = [
  {
    name: "error rate",
    passed: overall.errorPct <= thresholds.maxErrorPct,
    actual: `${overall.errorPct.toFixed(2)}%`,
    limit: `<= ${thresholds.maxErrorPct}%`,
  },
  {
    name: "p95 response time",
    passed: overall.p95Ms <= thresholds.maxP95Ms,
    actual: `${overall.p95Ms.toFixed(0)} ms`,
    limit: `<= ${thresholds.maxP95Ms} ms`,
  },
  {
    name: "average response time",
    passed: overall.avgMs <= thresholds.maxAvgMs,
    actual: `${overall.avgMs.toFixed(0)} ms`,
    limit: `<= ${thresholds.maxAvgMs} ms`,
  },
];

const summary = {
  generatedAt: new Date().toISOString(),
  overall,
  thresholds,
  checks,
  labels,
  failedSamples: failures.slice(0, 20).map((sample) => ({
    label: sample.label,
    code: sample.code,
    elapsedMs: sample.elapsed,
  })),
};

await writeFile(summaryFile, JSON.stringify(summary, null, 2) + "\n", "utf8");

console.log("\n========================================================================");
console.log("HEAVEN-BUS PERFORMANCE SUMMARY");
console.log("========================================================================");
console.log(`Samples:              ${overall.samples}`);
console.log(`Errors:               ${overall.errors} (${overall.errorPct.toFixed(2)}%)`);
console.log(`Average response:     ${overall.avgMs.toFixed(0)} ms`);
console.log(`P90 response:         ${overall.p90Ms.toFixed(0)} ms`);
console.log(`P95 response:         ${overall.p95Ms.toFixed(0)} ms`);
console.log(`P99 response:         ${overall.p99Ms.toFixed(0)} ms`);
console.log(`Maximum response:     ${overall.maxMs.toFixed(0)} ms`);
console.log(`Throughput:           ${overall.throughputRps.toFixed(2)} requests/sec`);
console.log(`Test duration:        ${overall.durationSeconds.toFixed(2)} sec`);
console.log("");

for (const check of checks) {
  console.log(
    `${check.passed ? "✓ PASS" : "✗ FAIL"} ${check.name}: ${check.actual} (target ${check.limit})`,
  );
}

console.log("\nEndpoint breakdown:");
for (const [label, stats] of Object.entries(labels)) {
  console.log(
    `  ${label}: samples=${stats.samples}, errors=${stats.errorPct.toFixed(2)}%, avg=${stats.avgMs.toFixed(0)}ms, p95=${stats.p95Ms.toFixed(0)}ms`,
  );
}
console.log("\nHTML dashboard: performance/report/index.html");
console.log("Machine-readable summary: performance/summary.json\n");

if (checks.some((check) => !check.passed)) {
  process.exitCode = 1;
}
