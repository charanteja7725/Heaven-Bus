import { col, now, type Store } from "./db.js";

export type JourneyEmailConfig = {
  apiKey?: string;
  from?: string;
  appUrl: string;
};

function istDayRange(clock: Date) {
  const day = clock.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return {
    day,
    start: new Date(`${day}T00:00:00+05:30`),
    end: new Date(`${day}T23:59:59.999+05:30`),
  };
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function sendResend(
  config: JourneyEmailConfig,
  to: string,
  subject: string,
  html: string,
) {
  if (!config.apiKey || !config.from)
    return { sent: false, reason: "EMAIL_PROVIDER_NOT_CONFIGURED" as const };

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.from,
      to: [to],
      subject,
      html,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      typeof body?.message === "string"
        ? body.message
        : `Email provider returned ${response.status}`,
    );
  return { sent: true, providerId: body?.id ?? null };
}

export async function processJourneyDayEmails(
  s: Store,
  config: JourneyEmailConfig,
) {
  const clock = await now(s);
  const { day, start, end } = istDayRange(clock);
  const bookings = await col(s, "bookings")
    .find({
      status: "CONFIRMED",
      "trip.departureAt": { $gte: start, $lte: end },
      notificationEmail: { $type: "string", $ne: "" },
      $or: [
        { journeyDayEmailDay: { $ne: day } },
        { journeyDayEmailStatus: { $ne: "SENT" } },
      ],
    })
    .limit(100)
    .toArray();

  let sent = 0;
  for (const booking of bookings) {
    const email = String(booking.notificationEmail).trim().toLowerCase();
    const notificationId = `journey-day:${booking._id}:${day}`;
    const existing = await col(s, "emailNotifications").findOne({
      _id: notificationId,
    });
    if (existing?.status === "SENT") {
      await col(s, "bookings").updateOne(
        { _id: booking._id },
        {
          $set: {
            journeyDayEmailDay: day,
            journeyDayEmailStatus: "SENT",
            journeyDayEmailSentAt: existing.sentAt,
          },
        },
      );
      continue;
    }

    const departure = new Date(booking.trip.departureAt).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    const trackUrl = `${config.appUrl.replace(/\/$/, "")}/journey/${encodeURIComponent(booking._id)}/live`;
    const subject = `HEAVEN-BUS journey today · ${booking.trip.from} to ${booking.trip.to}`;
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#16352a">
        <h2>Your HEAVEN-BUS journey is today</h2>
        <p><strong>${escapeHtml(booking.trip.from)} → ${escapeHtml(booking.trip.to)}</strong></p>
        <p>Departure: ${escapeHtml(departure)} IST</p>
        <p>Bus: ${escapeHtml(booking.trip.name)} · Seats ${escapeHtml(booking.seatIds.join(", "))}</p>
        <p>Booking reference: ${escapeHtml(booking.reference)}</p>
        <p><a href="${escapeHtml(trackUrl)}">Open live journey tracking</a></p>
        <p>Please arrive at your boarding point early and keep your ticket available.</p>
        <hr />
        <small>HEAVEN-BUS demo notification. Support numbers and schedules in this project are demonstration data.</small>
      </div>`;

    await col(s, "emailNotifications").updateOne(
      { _id: notificationId },
      {
        $setOnInsert: {
          _id: notificationId,
          bookingId: booking._id,
          userId: booking.userId,
          email,
          type: "JOURNEY_DAY",
          day,
          createdAt: clock,
        },
        $set: { lastAttemptAt: clock, status: "PROCESSING" },
        $inc: { attempts: 1 },
      },
      { upsert: true },
    );

    try {
      const result = await sendResend(config, email, subject, html);
      if (!result.sent) {
        await Promise.all([
          col(s, "emailNotifications").updateOne(
            { _id: notificationId },
            {
              $set: {
                status: result.reason,
                lastError:
                  "Configure RESEND_API_KEY and JOURNEY_EMAIL_FROM on Render to send journey-day email.",
              },
            },
          ),
          col(s, "bookings").updateOne(
            { _id: booking._id },
            {
              $set: {
                journeyDayEmailDay: day,
                journeyDayEmailStatus: result.reason,
              },
            },
          ),
        ]);
        continue;
      }

      await Promise.all([
        col(s, "emailNotifications").updateOne(
          { _id: notificationId },
          {
            $set: {
              status: "SENT",
              providerId: result.providerId,
              sentAt: clock,
              lastError: null,
            },
          },
        ),
        col(s, "bookings").updateOne(
          { _id: booking._id },
          {
            $set: {
              journeyDayEmailDay: day,
              journeyDayEmailStatus: "SENT",
              journeyDayEmailSentAt: clock,
            },
          },
        ),
      ]);
      sent++;
    } catch (error) {
      const message =
        error instanceof Error ? error.message.slice(0, 500) : "Email delivery failed";
      await Promise.all([
        col(s, "emailNotifications").updateOne(
          { _id: notificationId },
          { $set: { status: "RETRY", lastError: message } },
        ),
        col(s, "bookings").updateOne(
          { _id: booking._id },
          {
            $set: {
              journeyDayEmailDay: day,
              journeyDayEmailStatus: "RETRY",
            },
          },
        ),
      ]);
    }
  }
  return { checked: bookings.length, sent };
}
