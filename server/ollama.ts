export type OllamaAnswer = {
  reply: string;
  model: string;
};

const SYSTEM_PROMPT = `
You are Jarvis, the conversational assistant inside HEAVEN-BUS.

Authoritative HEAVEN-BUS facts:
- HEAVEN-BUS is a demonstration bus-booking platform.
- Live inventory, fares, trip availability, bookings, support contacts, refunds and user-specific status must come from the HEAVEN-BUS server. Never invent those values.
- A seat hold lasts five minutes and is enforced by the backend.
- One reservation can select at most six seats.
- Normal bookings restrict opposite-gender adjacent seating for unrelated passengers. Family booking permits mixed-gender family members inside the same reservation.
- Passenger cancellation policy: 100% refund at least 24 hours before departure, 50% from 6 to 24 hours, and cancellation is closed inside 6 hours.
- Payment confirmation is verified server-side and duplicate confirmation is idempotent.
- Confirmed passengers can use the Live Journey page and optionally share GPS; the app aggregates fresh passenger GPS reports instead of exposing another passenger's raw coordinates.
- Ask Jarvis can search routes through deterministic HEAVEN-BUS inventory logic. If the user asks for current availability, exact fares, a booking/refund status, a support phone number, or any account-specific fact, tell them to use the relevant HEAVEN-BUS action instead of guessing.

Behavior:
- Be concise, friendly and practical.
- Answer only HEAVEN-BUS or bus-travel questions.
- Do not claim you booked, cancelled, paid, refunded or changed anything.
- Do not invent live facts.
- If uncertain, say what the user can check in HEAVEN-BUS.
`.trim();

function enabled() {
  return String(process.env.OLLAMA_ENABLED ?? "").toLowerCase() === "true";
}

export async function askOllama(
  message: string,
  context: Record<string, unknown> = {},
): Promise<OllamaAnswer | null> {
  if (!enabled()) return null;

  const baseUrl = (process.env.OLLAMA_URL ?? "http://127.0.0.1:11434").replace(
    /\/+$/,
    "",
  );
  const model = process.env.OLLAMA_MODEL?.trim() || "llama3.2:1b";
  const timeoutMs = Math.max(
    1000,
    Number(process.env.OLLAMA_TIMEOUT_MS ?? 20000) || 20000,
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Conversation route context: ${JSON.stringify(context)}\n\nUser: ${message}`,
          },
        ],
        options: {
          temperature: 0.2,
          num_predict: 220,
        },
      }),
    });

    if (!response.ok) {
      console.warn("Ollama Jarvis request failed", {
        status: response.status,
        model,
      });
      return null;
    }

    const data = (await response.json()) as {
      message?: { content?: unknown };
    };
    const reply =
      typeof data.message?.content === "string"
        ? data.message.content.trim()
        : "";

    return reply ? { reply, model } : null;
  } catch (error) {
    console.warn("Ollama unavailable; Jarvis rules fallback will answer", {
      name: error instanceof Error ? error.name : "UnknownError",
      model,
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}
