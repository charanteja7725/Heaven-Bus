import * as chrono from "chrono-node";
import { cities } from "./seed.js";
import { col, now, type Store } from "./db.js";
import {
  findSupportContacts,
  supportDisclaimer,
  type SupportContact,
} from "./support.js";

export type JarvisResponse = {
  reply: string;
  context: any;
  trips?: any[];
  supportContacts?: SupportContact[];
  supportDisclaimer?: string;
};

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

function includesAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function friendlyStatus(value: unknown) {
  return String(value ?? "UNKNOWN")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

async function knownLocations(s: Store) {
  const current = await now(s);
  const filter = { status: "PUBLISHED", departureAt: { $gt: current } };
  const [from, to] = await Promise.all([
    col(s, "trips").distinct("from", filter),
    col(s, "trips").distinct("to", filter),
  ]);
  return [...new Set([...cities, ...from, ...to])]
    .filter((value): value is string => typeof value === "string" && !!value.trim())
    .sort((a, b) => b.length - a.length);
}

function detectedLocations(text: string, locations: string[]) {
  const found: Array<{ city: string; index: number }> = [];
  const lower = text.toLowerCase();

  for (const [alias, city] of Object.entries(aliases)) {
    const index = lower.indexOf(alias);
    if (index >= 0) found.push({ city, index });
  }
  for (const city of locations) {
    const index = lower.indexOf(city.toLowerCase());
    if (index >= 0 && !found.some((entry) => entry.city === city))
      found.push({ city, index });
  }

  return found.sort((a, b) => a.index - b.index);
}

async function answerMyBooking(s: Store, userId?: string) {
  if (!userId)
    return "Sign in first, then ask me “what is my latest booking?” and I can read only your own HEAVEN-BUS journeys.";

  const bookings = await col(s, "bookings")
    .find({ userId })
    .sort({ createdAt: -1 })
    .limit(3)
    .toArray();

  if (!bookings.length)
    return "You do not have a confirmed HEAVEN-BUS booking yet. Search a route, choose seats, complete payment, and the ticket will appear in My journeys.";

  const latest = bookings[0];
  const seats = Array.isArray(latest.seatIds) ? latest.seatIds.join(", ") : "";
  return `Your latest booking is ${latest.reference ?? latest._id}: ${latest.trip?.from ?? "Origin"} → ${latest.trip?.to ?? "Destination"}, seats ${seats || "not listed"}, status ${friendlyStatus(latest.status)}. Open My journeys to view the ticket, cancellation options, refund status, and live journey link.`;
}

async function answerMyRefund(s: Store, userId?: string) {
  if (!userId)
    return "Sign in first, then ask me “what is my refund status?” and I can check only your own HEAVEN-BUS refund records.";

  const refund = await col(s, "refunds")
    .find({ userId })
    .sort({ createdAt: -1 })
    .limit(1)
    .next();

  if (!refund)
    return "I cannot find a refund request on your account. If you cancel an eligible confirmed ticket, its refund information will appear under My journeys.";

  const booking = await col(s, "bookings").findOne({ holdId: refund.holdId, userId });
  const reference = booking?.reference ? ` for booking ${booking.reference}` : "";
  const amount =
    typeof refund.amount === "number"
      ? ` The refund amount is ₹${(refund.amount / 100).toLocaleString("en-IN")}.`
      : "";
  return `Your latest refund${reference} is currently ${friendlyStatus(refund.status)}.${amount} Passenger-requested cancellation refunds may require admin approval before processing. Open My journeys for the latest status.`;
}

async function searchTrips(
  s: Store,
  message: string,
  context: any,
  locations: string[],
): Promise<JarvisResponse> {
  const text = message.toLowerCase();
  const matches = detectedLocations(message, locations);
  let from = context.from,
    to = context.to;

  const fromWord = text.indexOf("from ");
  const toWord = text.indexOf("to ");

  if (fromWord >= 0) {
    const match = matches.find((entry) => entry.index > fromWord);
    if (match) from = match.city;
  }
  if (toWord >= 0) {
    const match = matches.find((entry) => entry.index > toWord);
    if (match) to = match.city;
  }

  if (matches.length >= 2) {
    if (!from) from = matches[0].city;
    if (!to) to = matches.find((entry) => entry.city !== from)?.city;
  } else if (matches.length === 1 && !from && !to) {
    if (/\bto\b/.test(text)) to = matches[0].city;
    else from = matches[0].city;
  } else if (matches.length === 1) {
    const city = matches[0].city;
    if (!from && !to) {
      if (/\bto\b/.test(text)) to = city;
      else from = city;
    } else if (!from && city !== to && fromWord >= 0) {
      from = city;
    } else if (!to && city !== from && toWord >= 0) {
      to = city;
    }
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
      reply: from
        ? `Leaving from ${from}. Where would you like to go?`
        : to
          ? `Heading to ${to}. Where are you travelling from?`
          : "Tell me your origin and destination, for example “Bengaluru to Chennai tomorrow under ₹1,000”.",
      context: next,
    };

  if (from === to)
    return {
      reply: "Choose two different locations so I can find your journey.",
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
    trips = trips.filter((trip) => {
      const hour = new Date(
        new Date(trip.departureAt).getTime() + 19800000,
      ).getUTCHours();
      return night ? hour >= 18 : hour < 18;
    });

  const enriched = await Promise.all(
    trips.map(async (trip) => ({
      ...trip,
      available: await col(s, "seats").countDocuments({
        tripId: trip._id,
        $or: [
          { state: "AVAILABLE" },
          { state: "HELD", expiresAt: { $lte: current } },
        ],
      }),
    })),
  );
  const available = enriched.filter((trip) => trip.available > 0);

  return {
    reply: available.length
      ? `I found ${available.length} ${available.length === 1 ? "bus" : "buses"} from ${from} to ${to} on ${date}${maxFare ? ` within ₹${(maxFare / 100).toLocaleString("en-IN")}` : ""}. Choose a bus to see its live seat map. Your five-minute hold begins only after you select a seat.`
      : `I couldn’t find an available HEAVEN-BUS trip from ${from} to ${to} on ${date}. Try another date${maxFare ? " or a higher budget" : ""}. Available locations include ${locations.slice(0, 12).join(", ")}.`,
    trips: available,
    context: next,
  };
}

export async function askJarvis(
  s: Store,
  message: string,
  context: any = {},
  userId?: string,
): Promise<JarvisResponse> {
  const text = message.toLowerCase().trim();
  const locations = await knownLocations(s);
  const matches = detectedLocations(message, locations);
  const routeFollowup =
    Boolean(context.from || context.to) &&
    includesAny(text, [
      /under|below|budget|price/,
      /today|tomorrow|tonight|morning|evening|night/,
      /\bto\b|\bfrom\b/,
    ]);
  const explicitRoute =
    matches.length >= 2 ||
    (matches.length >= 1 && /\b(to|from)\b/.test(text)) ||
    routeFollowup;

  if (explicitRoute) return searchTrips(s, message, context, locations);

  if (/\b(hi|hello|hey|hai|good morning|good evening)\b/.test(text))
    return {
      reply:
        "Hi! I’m Jarvis, the HEAVEN-BUS assistant. I can search live trips, explain booking and seat holds, check your own booking/refund status when you are signed in, give cancellation rules, help with payments, tickets, GPS tracking, notification email, family seating, and show the right support number.",
      context,
    };

  if (
    includesAny(text, [
      /what (is|does) heaven[- ]?bus/,
      /about (this|the) app/,
      /what can you do/,
      /help me use/,
      /how (does|do) (this|the) app/,
      /features/,
    ])
  )
    return {
      reply:
        "HEAVEN-BUS is a real-time bus booking app. You can search routes, choose live seats, hold selected seats for five minutes, pay and receive a ticket, manage cancellations/refunds, use family-aware seating, track a confirmed journey with passenger-powered GPS, receive journey notifications, and contact issue-specific support. Ask me any of those topics directly.",
      context,
    };

  if (/\bmy\s+(latest\s+)?(booking|ticket|journey)|booking status|ticket status\b/.test(text))
    return { reply: await answerMyBooking(s, userId), context };

  if (/\bmy\s+refund|refund status|where.*refund|refund.*pending\b/.test(text))
    return {
      reply: await answerMyRefund(s, userId),
      supportContacts: findSupportContacts("refund"),
      supportDisclaimer,
      context,
    };

  if (/refund|money\s*back|refund policy/.test(text))
    return {
      reply:
        "For passenger cancellations, HEAVEN-BUS gives a 100% refund when cancelled at least 24 hours before departure, 50% from 6 to 24 hours, and cancellation closes inside 6 hours. Passenger-requested refunds can require admin approval. If a payment is captured after a seat hold is no longer valid, the system routes it into refund/reconciliation handling instead of creating a duplicate booking.",
      supportContacts: findSupportContacts("refund"),
      supportDisclaimer,
      context,
    };

  if (/cancel|cancellation/.test(text))
    return {
      reply:
        "Before payment, you can simply release your seat hold. For a confirmed ticket, open My journeys and choose Cancel confirmed ticket. The current policy is 100% refund at least 24 hours before departure, 50% from 6–24 hours, and cancellation is closed inside 6 hours.",
      supportContacts: findSupportContacts("cancellation"),
      supportDisclaimer,
      context,
    };

  if (/hold|lock|expire|countdown|five[- ]?minute|5[- ]?minute/.test(text))
    return {
      reply:
        "When you select your first seat, HEAVEN-BUS creates a five-minute server-side hold. Other passengers cannot take those held seats. Refreshing the page or starting payment does not extend the deadline. If time runs out or you release the hold, the seats automatically become available again.",
      context,
    };

  if (/family booking|family seat|family.*together/.test(text))
    return {
      reply:
        "Turn on Family booking before selecting seats. It allows male and female family members inside the same reservation to sit together. It does not bypass seating restrictions next to an unrelated passenger, and Family mode cannot be changed after seats are already held unless you release them first.",
      context,
    };

  if (
    includesAny(text, [
      /how.*book/,
      /book.*seat/,
      /choose.*seat/,
      /seat selection/,
      /how.*seat/,
      /maximum.*seat/,
      /how many seats/,
    ])
  )
    return {
      reply:
        "Search a route, choose a bus, select the passenger gender, then select up to six seats. Your first selected seat starts the five-minute hold. Continue to checkout, enter passenger/contact details and the notification email, then complete payment. After verification, HEAVEN-BUS creates the confirmed ticket under My journeys.",
      context,
    };

  if (/gender|male.*female|female.*male|adjacent seat/.test(text))
    return {
      reply:
        "HEAVEN-BUS stores the passenger gender with each selected seat. By default, opposite-gender adjacent seating is restricted for unrelated reservations. Family booking is the exception: mixed-gender family members in the same reservation can sit together.",
      context,
    };

  if (/payment|razorpay|pay|charged|transaction/.test(text))
    return {
      reply:
        "HEAVEN-BUS currently supports the demo sandbox payment flow and has Razorpay Test Mode integration. Payment confirmation is verified on the backend, and repeated verification is idempotent so it does not create duplicate tickets. If a captured payment cannot safely become a booking, it is handled through reconciliation/refund logic.",
      supportContacts: /charged|payment.*problem|payment.*issue|failed payment/.test(text)
        ? findSupportContacts("charged refund")
        : undefined,
      supportDisclaimer,
      context,
    };

  if (/notification email|email|mail|ticket.*mail|confirmation.*mail/.test(text))
    return {
      reply:
        "At checkout, enter the email address where you want journey notifications. After the ticket is confirmed, HEAVEN-BUS queues a confirmation email containing the route, booking reference, seats, ticket link and live-journey link. Journey-day reminders use the same notification address when the configured email provider is available.",
      context,
    };

  if (/live tracking|gps|live location|current location|track.*bus|where.*bus/.test(text))
    return {
      reply:
        "Open My journeys → Live Journey on a confirmed ticket. You can press Use my current location to see your GPS position toward the destination. During an in-progress journey, opted-in passenger GPS reports are combined into the shared bus position; other passengers do not see an individual traveller’s raw coordinates.",
      supportContacts:
        /not working|not updating|problem|issue|number|contact|call/.test(text)
          ? findSupportContacts("tracking")
          : undefined,
      supportDisclaimer,
      context,
    };

  if (/ticket|qr|reference|booking reference/.test(text))
    return {
      reply:
        "After successful payment verification, your confirmed ticket appears in My journeys. Open the ticket to see the booking reference, route, bus, passengers and seats. The confirmation email also includes a View ticket link when outbound email is configured.",
      context,
    };

  if (/login|sign in|register|account|password/.test(text))
    return {
      reply:
        "Create an account with your name, email and a password of at least 10 characters, then sign in to hold seats, pay, view tickets, cancel bookings, check refunds and use private journey features. Authentication uses JWT sessions and hashed passwords.",
      context,
    };

  if (/admin|operator|operations dashboard/.test(text))
    return {
      reply:
        "The Operations dashboard is for administrators. It provides trip management, booking visibility, active holds, refund review, payment exceptions and operational summaries. Passenger booking and support actions stay in the normal HEAVEN-BUS experience.",
      context,
    };

  if (/support|contact|mobile number|phone number|customer care|helpline|call|complaint/.test(text)) {
    const supportContacts = findSupportContacts(text);
    return {
      reply:
        supportContacts.length === 1
          ? `For general HEAVEN-BUS help, contact the ${supportContacts[0].role}. If you tell me the issue—refund, delay, GPS, luggage, cleaning, safety, boarding, AC, charging, toilet, staff, etc.—I can show the specific desk instead.`
          : "Tell me the issue and I’ll show the responsible HEAVEN-BUS support desk and number.",
      supportContacts,
      supportDisclaimer,
      context,
    };
  }

  const supportContacts = findSupportContacts(text);
  if (supportContacts.length)
    return {
      reply:
        supportContacts.length === 1
          ? `For ${supportContacts[0].issue.toLowerCase()}, contact the ${supportContacts[0].role}. I’ve shown the responsible number below.`
          : "I found the HEAVEN-BUS desks responsible for those issues. Use the matching contact below; urgent safety-related issues are marked.",
      supportContacts,
      supportDisclaimer,
      context,
    };

  if (/trip|bus|route|travel|journey|available/.test(text))
    return {
      reply:
        "I can search live HEAVEN-BUS inventory, but I need the origin and destination. Try “Bengaluru to Chennai tomorrow”, “Coimbatore to Chennai under ₹900”, or tell me one location at a time.",
      context,
    };

  return {
    reply:
      "I can help with HEAVEN-BUS questions about trips/routes, seat booking, five-minute holds, payments, tickets, cancellations, refunds, support/mobile numbers, family and gender seating, email notifications, live GPS tracking, accounts, and your own booking/refund status when signed in. Ask me one of those topics and I’ll answer from the app’s actual rules.",
    context,
  };
}
