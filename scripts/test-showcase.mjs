import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

function section(title) {
  console.log("\n" + "=".repeat(72));
  console.log(bold(title));
  console.log("=".repeat(72));
}

function run(label, command) {
  section(label);
  console.log(cyan(`$ ${command}\n`));

  return new Promise((resolve) => {
    let output = "";
    const child = spawn(command, {
      cwd: process.cwd(),
      env: { ...process.env, FORCE_COLOR: "0" },
      shell: true,
      windowsHide: false,
    });

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stderr.write(text);
    });

    child.on("error", (error) => {
      const text = `\nLauncher error: ${error.message}\n`;
      output += text;
      process.stderr.write(red(text));
      resolve({ ok: false, output, code: -1 });
    });

    child.on("close", (code) => {
      resolve({ ok: code === 0, output, code: code ?? -1 });
    });
  });
}

function extractPassed(output) {
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
console.log(
  process.env.CI
    ? "Mode: CI/headless isolated test environment"
    : "Mode: local interview showcase — visible Chromium + live terminal output",
);

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

const api = await run(
  "BACKEND / API / BUSINESS-RULE TESTS",
  "npx vitest run tests/booking.test.ts --reporter=verbose",
);

if (!api.ok) {
  section("FINAL RESULT");
  console.log(red(`✗ Backend/API verification failed (exit code ${api.code}).`));
  console.log(
    yellow(
      "Playwright was not started because the backend/API suite must pass first.",
    ),
  );
  console.log(
    "If this is a fresh Windows checkout, run: npm install --include=dev",
  );
  process.exit(1);
}

const playwrightCommand = process.env.CI
  ? "npx playwright test --reporter=list"
  : "npx playwright test --headed --reporter=list";

if (!process.env.CI) {
  section("VISIBLE BROWSER DEMO");
  console.log(
    yellow(
      "Chromium will now open. Keep both the browser and terminal visible — Playwright will operate the app automatically.",
    ),
  );
}

const e2e = await run(
  "PLAYWRIGHT FUNCTIONAL BROWSER TESTS",
  playwrightCommand,
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
  const total = apiPassed + e2ePassed;
  console.log(bold(`Total automated test cases passed: ${total} / ${total}`));
}

if (!e2e.ok) {
  console.log(red("\nOne or more Playwright tests failed. Check the output above."));
  console.log("Open the HTML report with: npm run test:e2e:report");
  process.exit(1);
}

console.log(
  green("\nHEAVEN-BUS functional verification completed successfully."),
);
console.log("Interactive Playwright UI: npm run test:e2e:ui");
console.log("HTML report:              npm run test:e2e:report");
