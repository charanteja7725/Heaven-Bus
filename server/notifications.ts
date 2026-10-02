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

function formatDeparture(value: unknown) {
  return new Date(String(value)).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
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

export async function processBookingConfirmationEmails(
  s: Store,
  config: JourneyEmailConfig,
) {
  const clock = await now(s);
  const bookings = await col(s, "bookings")
    .find({
      status: "CONFIRMED",
      notificationEmail: { $type: "string", $ne: "" },
      $or: [
        { confirmationEmailStatus: { $exists: false } },
        {
          confirmationEmailStatus: {
            $in: ["PENDING", "RETRY", "EMAIL_PROVIDER_NOT_CONFIGURED"],
          },
        },
      ],
    })
    .sort({ createdAt: 1 })
    .limit(100)
    .toArray();

  let sent = 0;
  for (const booking of bookings) {
    const notificationId = `booking-confirmation:${booking._id}`;
    const existing = await col(s, "emailNotifications").findOne({
      _id: notificationId,
    });

    if (existing?.status === "SENT") {
      await col(s, "bookings").updateOne(
        { _id: booking._id },
        {
          $set: {
            confirmationEmailStatus: "SENT",
            confirmationEmailSentAt: existing.sentAt,
          },
        },
      );
      continue;
    }

    const email = String(booking.notificationEmail).trim().toLowerCase();
    const ticketUrl = `${config.appUrl.replace(/\/$/, "")}/ticket/${encodeURIComponent(booking._id)}`;
    const trackingUrl = `${config.appUrl.replace(/\/$/, "")}/journey/${encodeURIComponent(booking._id)}/live`;
    const departure = formatDeparture(booking.trip?.departureAt);
    const passengers = Array.isArray(booking.passengers)
      ? booking.passengers
          .map(
            (passenger: any, index: number) =>
              `<li>${escapeHtml(passenger.name)} · Seat ${escapeHtml(booking.seatIds?.[index] ?? "")}${passenger.gender ? ` · ${escapeHtml(passenger.gender)}` : ""}</li>`,
          )
          .join("")
      : "";

    const subject = `HEAVEN-BUS ticket confirmed · ${booking.reference}`;
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#17352b">
        <div style="padding:24px;border:1px solid #dce5df;border-radius:18px;background:#ffffff">
          <p style="font-size:12px;letter-spacing:.12em;color:#6d7d75;margin:0 0 8px">HEAVEN-BUS</p>
          <h1 style="margin:0 0 18px;font-size:26px">Your ticket is confirmed</h1>
          <p style="font-size:17px"><strong>${escapeHtml(booking.trip?.from)} → ${escapeHtml(booking.trip?.to)}</strong></p>
          <p>Bus: <strong>${escapeHtml(booking.trip?.name)}</strong></p>
          <p>Departure: <strong>${escapeHtml(departure)} IST</strong></p>
          <p>Booking reference: <strong>${escapeHtml(booking.reference)}</strong></p>
          <p>Seats: <strong>${escapeHtml((booking.seatIds ?? []).join(", "))}</strong></p>
          ${passengers ? `<p>Passengers:</p><ul>${passengers}</ul>` : ""}
          <p>Total paid: <strong>₹${Number((booking.amount ?? 0) / 100).toLocaleString("en-IN")}</strong></p>
          <div style="margin:24px 0">
            <a href="${escapeHtml(ticketUrl)}" style="display:inline-block;padding:12px 18px;margin-right:8px;background:#174f3e;color:white;text-decoration:none;border-radius:10px">View ticket</a>
            <a href="${escapeHtml(trackingUrl)}" style="display:inline-block;padding:12px 18px;background:#f06b42;color:white;text-decoration:none;border-radius:10px">Live journey</a>
          </div>
          <p style="font-size:13px;color:#6d7d75">Keep this email and your booking reference available for your journey.</p>
          <hr style="border:0;border-top:1px solid #dce5df;margin:22px 0" />
          <small style="color:#7f8f87">HEAVEN-BUS hackathon/demo ticket. Support contacts and demo schedules must be replaced with production operator data before commercial use.</small>
        </div>
      </div>`;

    await col(s, "emailNotifications").updateOne(
      { _id: notificationId },
      {
        $setOnInsert: {
          _id: notificationId,
          bookingId: booking._id,
          userId: booking.userId,
          email,
          type: "BOOKING_CONFIRMATION",
          createdAt: clock,
        },
        $set: {
          lastAttemptAt: clock,
          status: "PROCESSING",
        },
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
                  "Configure RESEND_API_KEY and JOURNEY_EMAIL_FROM on Render to send confirmation email.",
              },
            },
          ),
          col(s, "bookings").updateOne(
            { _id: booking._id },
            {
              $set: {
                confirmationEmailStatus: result.reason,
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
              confirmationEmailStatus: "SENT",
              confirmationEmailSentAt: clock,
            },
          },
        ),
      ]);
      sent++;
      console.log("Booking confirmation email sent", {
        bookingId: booking._id,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message.slice(0, 500)
          : "Email delivery failed";
      await Promise.all([
        col(s, "emailNotifications").updateOne(
          { _id: notificationId },
          {
            $set: {
              status: "RETRY",
              lastError: message,
            },
          },
        ),
        col(s, "bookings").updateOne(
          { _id: booking._id },
          {
            $set: {
              confirmationEmailStatus: "RETRY",
            },
          },
        ),
      ]);
      console.error("Booking confirmation email failed; retry scheduled", {
        bookingId: booking._id,
      });
    }
  }

  return { checked: bookings.length, sent };
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

    const departure = formatDeparture(booking.trip.departureAt);
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
