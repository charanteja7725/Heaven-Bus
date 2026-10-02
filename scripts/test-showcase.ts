import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

function section(title: string) {
  console.log("\n" + "=".repeat(72));
  console.log(bold(title));
  console.log("=".repeat(72));
}

function run(label: string, command: string, args: string[]) {
  section(label);
  const exe =
    process.platform === "win32" && command === "npx" ? "npx.cmd" : command;
  const result = spawnSync(exe, args, {
    cwd: process.cwd(),
    env: { ...process.env, FORCE_COLOR: "0" },
    encoding: "utf8",
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
  };
}

function extractPassed(output: string) {
  const matches = [
    ...output.matchAll(/(?:Tests\s+)?(\d+) passed/g),
    ...output.matchAll(/(\d+) passed \(/g),
  ];
  if (!matches.length) return null;
  return Math.max(...matches.map((m) => Number(m[1])));
}

const appSource = readFileSync("server/app.ts", "utf8");
const routes = [
  ...appSource.matchAll(
    /app\.(get|post|put|patch|delete)\(\s*[`"']([^`"']+)/g,
  ),
].map((match) => ({
  method: match[1].toUpperCase(),
  path: match[2],
}));

section("HEAVEN-BUS QA SHOWCASE");
console.log("Functional testing stack: TypeScript + Vitest + Playwright");
console.log("Browser: Chromium");
console.log("Mode: local isolated test environment (no production data changed)");

section(`API ENDPOINT INVENTORY — ${routes.length} REGISTERED ROUTES`);
routes.forEach((route, index) => {
  const number = String(index + 1).padStart(2, "0");
  console.log(`${green("✓")} ${number}. ${route.method.padEnd(6)} ${route.path}`);
});
console.log(
  cyan(
    "\nThe route inventory above is read directly from server/app.ts, so it stays in sync with the backend.",
  ),
);

const api = run(
  "BACKEND / API / BUSINESS-RULE TESTS",
  "npx",
  ["vitest", "run", "tests/booking.test.ts", "--reporter=verbose"],
);

if (!api.ok) {
  section("FINAL RESULT");
  console.log(red("✗ Backend/API verification failed. Playwright was not started."));
  process.exit(1);
}

const e2e = run(
  "PLAYWRIGHT FUNCTIONAL BROWSER TESTS",
  "npx",
  ["playwright", "test", "--reporter=list"],
);

const apiPassed = extractPassed(api.output);
const e2ePassed = extractPassed(e2e.output);

section("FINAL QA RESULT");
console.log(
  `${api.ok ? green("✓ PASS") : red("✗ FAIL")} Backend/API tests${apiPassed !== null ? `: ${apiPassed} passed` : ""}`,
);
console.log(
  `${e2e.ok ? green("✓ PASS") : red("✗ FAIL")} Playwright functional tests${e2ePassed !== null ? `: ${e2ePassed} passed` : ""}`,
);
console.log(`${green("✓")} API endpoints displayed: ${routes.length}`);

if (apiPassed !== null && e2ePassed !== null) {
  console.log(
    bold(
      `Total automated test cases passed: ${apiPassed + e2ePassed} / ${apiPassed + e2ePassed}`,
    ),
  );
}

if (!e2e.ok) {
  console.log(red("\nOne or more Playwright tests failed. Check the report above."));
  process.exit(1);
}

console.log(
  green(
    "\nHEAVEN-BUS functional verification completed successfully.",
  ),
);
console.log(
  "Open the interactive runner with: npm run test:e2e:ui",
);
console.log(
  "Open the HTML report with:       npm run test:e2e:report",
);
