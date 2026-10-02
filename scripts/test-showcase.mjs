import "dotenv/config";
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

function createLineWriter(prefix, sink, capture) {
  let buffer = "";
  return {
    write(chunk) {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const rendered = prefix ? `${prefix} ${line}\n` : `${line}\n`;
        capture(rendered);
        sink.write(rendered);
      }
    },
    flush() {
      if (!buffer) return;
      const rendered = prefix ? `${prefix} ${buffer}\n` : `${buffer}\n`;
      capture(rendered);
      sink.write(rendered);
      buffer = "";
    },
  };
}

function run(label, command, prefix = "") {
  section(label);
  console.log(cyan(`$ ${command}\n`));

  return new Promise((resolve) => {
    let output = "";
    const capture = (text) => {
      output += text;
    };
    const child = spawn(command, {
      cwd: process.cwd(),
      env: { ...process.env, FORCE_COLOR: "0" },
      shell: true,
      windowsHide: false,
    });

    const out = createLineWriter(prefix, process.stdout, capture);
    const err = createLineWriter(prefix, process.stderr, capture);

    child.stdout.on("data", (chunk) => out.write(chunk));
    child.stderr.on("data", (chunk) => err.write(chunk));

    child.on("error", (error) => {
      const msg = `Launcher error: ${error.message}`;
      capture(msg + "\n");
      process.stderr.write(red((prefix ? prefix + " " : "") + msg + "\n"));
    });

    child.on("close", (code) => {
      out.flush();
      err.flush();
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
    : "Mode: local interview showcase — API tests + visible browser together",
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

const apiCommand =
  "npx vitest run tests/booking.test.ts --reporter=verbose";
const playwrightCommand = process.env.CI
  ? "npx playwright test --reporter=list"
  : "npx playwright test --headed --workers=1 --reporter=list";

let api;
let e2e;

if (process.env.CI) {
  api = await run("BACKEND / API / BUSINESS-RULE TESTS", apiCommand);
  e2e = api.ok
    ? await run("PLAYWRIGHT FUNCTIONAL BROWSER TESTS", playwrightCommand)
    : { ok: false, output: "", code: -1 };
} else {
  const showcaseMongoUri =
    process.env.SHOWCASE_MONGODB_URI ?? process.env.MONGODB_URI;

  if (
    !showcaseMongoUri ||
    /mongodb:\/\/(?:127\.0\.0\.1|localhost)/i.test(showcaseMongoUri)
  ) {
    section("SHOWCASE DATABASE CHECK");
    console.log(
      red(
        "✗ Visible showcase needs a MongoDB Atlas URI in MONGODB_URI or SHOWCASE_MONGODB_URI.",
      ),
    );
    console.log(
      yellow(
        "This avoids the ~600 MB mongodb-memory-server download that previously stopped Chromium from opening.",
      ),
    );
    process.exit(1);
  }

  process.env.PW_SHOWCASE = "1";
  section("VISIBLE BROWSER + TERMINAL TESTING");
  console.log(
    yellow(
      "Chromium is launching in headed mode. Browser scenarios run visibly one-by-one while API tests report in this terminal.",
    ),
  );
  console.log(
    yellow(
      "The live-seat concurrency scenario switches between two traveller views so you can see the hold and release update.",
    ),
  );

  [api, e2e] = await Promise.all([
    run("BACKEND / API / BUSINESS-RULE TESTS", apiCommand, "[API]"),
    run("PLAYWRIGHT FUNCTIONAL BROWSER TESTS", playwrightCommand, "[E2E]"),
  ]);
}

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
  const totalPassed = apiPassed + e2ePassed;
  const expected = 51;
  console.log(
    bold(
      `Total automated test cases passed: ${totalPassed} / ${expected}`,
    ),
  );
}

if (!api.ok || !e2e.ok) {
  console.log(
    red(
      "\nHEAVEN-BUS QA verification FAILED because at least one automated suite failed.",
    ),
  );
  console.log("Open the Playwright HTML report with: npm run test:e2e:report");
  process.exit(1);
}

console.log(
  green("\nHEAVEN-BUS functional verification completed successfully."),
);
console.log("Interactive Playwright UI: npm run test:e2e:ui");
console.log("HTML report:              npm run test:e2e:report");
