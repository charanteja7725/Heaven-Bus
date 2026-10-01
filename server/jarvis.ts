import * as chrono from "chrono-node";
import { cities } from "./seed.js";
import { col, now, type Store } from "./db.js";
const aliases: Record<string, string> = {
  bangalore: "Bengaluru",
  bengaluru: "Bengaluru",
  chennai: "Chennai",
  madras: "Chennai",
  hyderabad: "Hyderabad",
  mumbai: "Mumbai",
  bombay: "Mumbai",
  pune: "Pune",
  goa: "Goa",
  madurai: "Madurai",
  coimbatore: "Coimbatore",
};
export async function askJarvis(s: Store, message: string, context: any = {}) {
  const text = message.toLowerCase();
  if (/refund|money.*back/.test(text))
    return {
      reply:
        "If payment is captured after your five-minute hold expires, we create a refund request. Check My journeys for its status. A sandbox refund is simulated; bank processing times depend on the payment provider.",
      context,
    };
  if (
    /hold|lock|expire|countdown/.test(text) &&
    !cities.some((c) => text.includes(c.toLowerCase()))
  )
    return {
      reply:
        "Selecting your first seat starts a five-minute hold. Other passengers cannot take those seats during the hold. Refreshing or starting payment does not extend it. If you leave or time runs out, the seats automatically become available.",
      context,
    };
  if (/cancel/.test(text))
    return {
      reply:
        "Before payment, you can release your seat hold. For a confirmed ticket, cancellation gives a 100% refund at least 24 hours before departure, a 50% refund from 6 to 24 hours, and closes inside 6 hours. Open My journeys, select the ticket, and choose Cancel confirmed ticket.",
      context,
    };
  const cityPattern = `\\b(${Object.keys(aliases).join("|")})\\b`;
  const matches = [...text.matchAll(new RegExp(cityPattern, "g"))].map((m) => ({
    city: aliases[m[1]],
    index: m.index!,
  }));
  const explicitFrom = text.match(new RegExp(`\\bfrom\\s+${cityPattern}`));
  const explicitTo = text.match(new RegExp(`\\bto\\s+${cityPattern}`));
  let from = context.from,
    to = context.to;
  if (explicitFrom) from = aliases[explicitFrom[1]];
  if (explicitTo) to = aliases[explicitTo[1]];
  if (matches.length >= 2) {
    if (!explicitFrom)
      from = explicitTo
        ? matches.find((m) => m.city !== to)?.city
        : matches[0].city;
    if (!explicitTo)
      to = explicitFrom
        ? matches.find((m) => m.city !== from)?.city
        : matches[1].city;
  } else if (matches.length === 1 && !explicitFrom && !explicitTo) {
    if (!from) from = matches[0].city;
    else to = matches[0].city;
  }
  const current = await now(s);
  const localNow = new Date(current.getTime() + 19800000);
  let date = context.date ?? localNow.toISOString().slice(0, 10);
  if (/tomorrow/.test(text))
    date = new Date(localNow.getTime() + 86400000).toISOString().slice(0, 10);
  else if (/today|tonight/.test(text))
    date = localNow.toISOString().slice(0, 10);
  else {
    const parsed = chrono.parseDate(message, localNow, { forwardDate: true });
    if (parsed)
      date = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
  }
  const price = text.match(
    /(?:under|below|less than|budget(?: of)?)\s*(?:rs\.?|₹)?\s*(\d[\d,]*(?:\.\d{1,2})?)(?:\s*(k|thousand))?/i,
  );
  const maxFare = /no budget|any price|remove.*budget/.test(text)
    ? undefined
    : price
      ? Math.round(
          Number(price[1].replaceAll(",", "")) * (price[2] ? 1000 : 1) * 100,
        )
      : context.maxFare;
  const night = /night|evening|tonight/.test(text)
    ? true
    : /morning|daytime/.test(text)
      ? false
      : context.night;
  const next = { from, to, date, maxFare, night };
  if (!from || !to)
    return {
      reply: `${from ? `Leaving from ${from}. Where would you like to go?` : to ? `Heading to ${to}. Where are you travelling from?` : "Where are you travelling from and to?"} Try “Bengaluru to Chennai tomorrow under ₹1,000”. I search HEAVEN-BUS trips and can explain holds and refunds.`,
      context: next,
    };
  if (from === to)
    return {
      reply: "Choose two different cities so I can find your journey.",
      context: next,
      trips: [],
    };
  const filter: any = {
    from,
    to,
    date,
    status: "PUBLISHED",
    departureAt: { $gt: current },
  };
  if (maxFare) filter.fare = { $lte: maxFare };
  let trips = await col(s, "trips")
    .find(filter)
    .sort({ fare: 1 })
    .limit(10)
    .toArray();
  if (night !== undefined)
    trips = trips.filter((t) => {
      const hour = new Date(
        new Date(t.departureAt).getTime() + 19800000,
      ).getUTCHours();
      return night ? hour >= 18 : hour < 18;
    });
  const enriched = await Promise.all(
    trips.map(async (t) => ({
      ...t,
      available: await col(s, "seats").countDocuments({
        tripId: t._id,
        $or: [
          { state: "AVAILABLE" },
          { state: "HELD", expiresAt: { $lte: current } },
        ],
      }),
    })),
  );
  const available = enriched.filter((t) => t.available > 0);
  return {
    reply: available.length
      ? `I found ${available.length} ${available.length === 1 ? "option" : "options"} from ${from} to ${to} on ${date}${maxFare ? ` within ₹${maxFare / 100}` : ""}. Choose a trip to see live seats. Your five-minute hold begins only when you select a seat.`
      : `I couldn’t find an available trip matching ${from} to ${to} on ${date}. Try a different day${maxFare ? " or a higher budget" : ""}. Available cities: ${cities.join(", ")}.`,
    trips: available,
    context: next,
  };
}
