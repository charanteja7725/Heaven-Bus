import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";

const baseUrl = (process.env.OLLAMA_URL ?? "http://127.0.0.1:11434").replace(
  /\/+$/,
  "",
);

const version = spawnSync("ollama", ["--version"], {
  shell: true,
  encoding: "utf8",
});

if (version.status !== 0) {
  console.error("\n✗ Ollama CLI was not found in PATH.");
  console.error("Open Ollama once, then reopen this terminal and run npm run ollama:setup.\n");
  process.exit(1);
}

console.log("\nHEAVEN-BUS + Ollama setup");
console.log((version.stdout || version.stderr).trim());

let tags;
try {
  const response = await fetch(`${baseUrl}/api/tags`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  tags = await response.json();
} catch (error) {
  console.error("\n✗ Ollama is installed but its local server is not reachable at " + baseUrl);
  console.error("Start the Ollama desktop app (or run 'ollama serve'), then retry.\n");
  process.exit(1);
}

const models = Array.isArray(tags?.models)
  ? tags.models
      .map((entry) => String(entry?.name ?? "").trim())
      .filter(Boolean)
  : [];

if (!models.length) {
  console.error("\n✗ Ollama is running, but no local model is installed.");
  console.error("For a lighter laptop setup, run:");
  console.error("  ollama pull llama3.2:1b");
  console.error("\nThen run:");
  console.error("  npm run ollama:setup\n");
  process.exit(1);
}

const requested = process.env.OLLAMA_MODEL?.trim();
const model =
  (requested && models.includes(requested) ? requested : undefined) ??
  models.find((name) => /^llama3\.2(?::1b)?$/i.test(name)) ??
  models[0];

console.log("\nInstalled models:");
for (const name of models) console.log(`  - ${name}`);
console.log(`\nUsing ${model} for Ask Jarvis.`);

await writeFile(
  ".env.ollama",
  [
    "# Local-only HEAVEN-BUS Ollama settings",
    "# Ignored by Git.",
    "OLLAMA_ENABLED=true",
    `OLLAMA_URL=${baseUrl}`,
    `OLLAMA_MODEL=${model}`,
    "OLLAMA_TIMEOUT_MS=20000",
    "",
  ].join("\n"),
  "utf8",
);

try {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        {
          role: "user",
          content: "Reply with exactly: HEAVEN-BUS OLLAMA READY",
        },
      ],
      options: { temperature: 0, num_predict: 20 },
    }),
  });
  const data = await response.json();
  const reply = String(data?.message?.content ?? "").trim();
  console.log("\nModel test:", reply || "(no text returned)");
} catch {
  console.log("\n⚠ Settings were saved, but the model warm-up test timed out.");
}

console.log("\n✓ .env.ollama saved locally.");
console.log("✓ Ask Jarvis will use Ollama for free-form HEAVEN-BUS questions.");
console.log("✓ Critical inventory/booking/payment/refund logic remains server-controlled.");
console.log("\nStart the project with:");
console.log("  npm run dev:api");
console.log("  npm run dev\n");
