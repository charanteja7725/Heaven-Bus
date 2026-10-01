import { randomUUID } from "node:crypto";
import { type ClientSession } from "mongodb";
import { AppError, col, now, transaction, type Store } from "./db.js";

export type PassengerGender = "MALE" | "FEMALE" | "OTHER";

function adjacentSeatId(seatId: string) {
  const match = seatId.match(/^(\d+)([ABCD])$/);
  if (!match) return null;
  const partner: Record<string, string> = { A: "B", B: "A", C: "D", D: "C" };
  return `${match[1]}${partner[match[2]]}`;
}

function genderName(gender: PassengerGender) {
  return gender === "FEMALE"
    ? "female"
    : gender === "MALE"
      ? "male"
      : "other-gender";
}
export async function event(s: Store, session: ClientSession, tripId: string) {
  await col(s, "outbox").insertOne(
    { _id: randomUUID(), tripId, createdAt: new Date(), sentAt: null },
    { session },
  );
}
async function expire(
  s: Store,
  h: any,
  session: ClientSession,
  state = "EXPIRED",
) {
  const changed = await col(s, "holds").updateOne(
    { _id: h._id, active: true },
    { $set: { active: false, state } },
    { session },
  );
  if (!changed.modifiedCount) return;
  await col(s, "seats").updateMany(
    { holdId: h._id, state: "HELD" },
    {
      $set: {
        state: "AVAILABLE",
        holdId: null,
        expiresAt: null,
        gender: null,
      },
      $inc: { version: 1 },
    },
    { session },
  );
  await event(s, session, h.tripId);
}
export async function release(s: Store, userId: string, id: string) {
  return transaction(s, async (session) => {
    const h = await col(s, "holds").findOne({ _id: id, userId }, { session });
    if (!h) throw new AppError(404, "Reservation not found");
    if (h.state === "PAYMENT_PENDING")
      throw new AppError(
        409,
        "Payment is being checked. Your hold will still expire at its original deadline.",
      );
    if (h.active) await expire(s, h, session, "CANCELLED");
    return { ok: true };
  });
}
export async function selectSeats(
  s: Store,
  userId: string,
  tripId: string,
  seatIds: string[],
  key: string,
  requestedSeatGenders?: Record<string, PassengerGender>,
  familyBooking = false,
) {
  return transaction(s, async (session) => {
    const seatGenders: Record<string, PassengerGender> =
      requestedSeatGenders ??
      Object.fromEntries(seatIds.map((seatId) => [seatId, "MALE"]));
    if (
      seatIds.some(
        (seatId) =>
          !["MALE", "FEMALE", "OTHER"].includes(seatGenders[seatId]),
      ) ||
      Object.keys(seatGenders).some((seatId) => !seatIds.includes(seatId))
    )
      throw new AppError(
        400,
        "Choose a valid passenger gender for every selected seat.",
        "INVALID_SEAT_GENDER",
      );

    const idemId = `${userId}:hold:${key}`;
    const hash = JSON.stringify({
      tripId,
      seats: [...seatIds]
        .sort()
        .map((seatId) => [seatId, seatGenders[seatId]]),
      familyBooking,
    });
    const previous = await col(s, "idempotency").findOne(
      { _id: idemId },
      { session },
    );
    if (previous) {
      if (previous.hash !== hash)
        throw new AppError(
          409,
          "Request key already used for a different selection",
        );
      return previous.result;
    }
    const t = await col(s, "trips").findOne(
      { _id: tripId, status: "PUBLISHED" },
      { session },
    );
    const time = await now(s, session);
    if (!t || new Date(t.departureAt).getTime() <= time.getTime())
      throw new AppError(410, "This trip is no longer open for booking");
    let h = await col(s, "holds").findOne(
      { userId, active: true },
      { session },
    );
    if (h && h.expiresAt <= time) {
      await expire(s, h, session);
      h = null;
    }
    if (h && h.tripId !== tripId)
      throw new AppError(
        409,
        "Release your current seats before choosing another trip.",
      );
    if (h?.state === "PAYMENT_PENDING")
      throw new AppError(409, "Seats cannot change while payment is pending.");
    if (!h && !seatIds.length) return { hold: null };
    if (!h && time.getTime() + s.holdMs > new Date(t.departureAt).getTime())
      throw new AppError(410, "Bookings close five minutes before departure");

    const touchedSeats = new Set<string>([
      ...(h?.seatIds ?? []),
      ...seatIds,
    ]);
    const lockedPairs = new Set<string>();
    for (const seatId of touchedSeats) {
      const partner = adjacentSeatId(seatId);
      if (!partner) continue;
      const pairKey = [seatId, partner].sort().join(":");
      if (lockedPairs.has(pairKey)) continue;
      lockedPairs.add(pairKey);
      await col(s, "seats").updateMany(
        { tripId, seatId: { $in: [seatId, partner] } },
        { $inc: { pairVersion: 1 } },
        { session },
      );
    }

    for (const seatId of seatIds) {
      const gender = seatGenders[seatId];
      const partnerId = adjacentSeatId(seatId);
      if (!partnerId) continue;

      if (seatIds.includes(partnerId)) {
        const partnerGender = seatGenders[partnerId];
        if (partnerGender && partnerGender !== gender && !familyBooking)
          throw new AppError(
            409,
            `Seats ${seatId} and ${partnerId} are side by side. Choose Family booking to seat different genders together in the same reservation.`,
            "ADJACENT_GENDER_CONFLICT",
          );
        continue;
      }

      const partner = await col(s, "seats").findOne(
        { tripId, seatId: partnerId },
        { session },
      );
      const partnerOccupied =
        partner?.state === "BOOKED" ||
        (partner?.state === "HELD" &&
          partner.expiresAt &&
          partner.expiresAt > time);
      if (
        partnerOccupied &&
        partner.gender &&
        partner.gender !== gender
      )
        throw new AppError(
          409,
          `Seat ${seatId} can only be booked for a ${genderName(partner.gender)} passenger because adjacent seat ${partnerId} is already occupied.`,
          "ADJACENT_GENDER_RESTRICTED",
        );
    }

    const id = h?._id ?? randomUUID();
    const deadline = h?.expiresAt ?? new Date(time.getTime() + s.holdMs);
    for (const seatId of [...seatIds].sort()) {
      const owned = h?.seatIds.includes(seatId);
      const eligible = owned
        ? { state: "HELD", holdId: id, $expr: { $gt: ["$expiresAt", "$$NOW"] } }
        : {
            $or: [
              { state: "AVAILABLE" },
              { state: "HELD", $expr: { $lte: ["$expiresAt", "$$NOW"] } },
            ],
          };
      const result = await col(s, "seats").updateOne(
        { tripId, seatId, ...eligible },
        {
          $set: {
            state: "HELD",
            holdId: id,
            expiresAt: deadline,
            gender: seatGenders[seatId],
          },
          $inc: { version: 1 },
        },
        { session },
      );
      if (!result.matchedCount)
        throw new AppError(
          409,
          `Seat ${seatId} was just taken or your hold expired. Please choose again.`,
          "SEAT_CONFLICT",
        );
    }
    await col(s, "seats").updateMany(
      { holdId: id, state: "HELD", seatId: { $nin: seatIds } },
      {
        $set: {
          state: "AVAILABLE",
          holdId: null,
          expiresAt: null,
          gender: null,
        },
        $inc: { version: 1 },
      },
      { session },
    );
    const next = {
      _id: id,
      userId,
      tripId,
      seatIds,
      seatGenders,
      familyBooking,
      expiresAt: deadline,
      createdAt: h?.createdAt ?? time,
      state: seatIds.length ? "ACTIVE" : "CANCELLED",
      active: !!seatIds.length,
      amount: t.fare * seatIds.length,
      currency: "INR",
    };
    await col(s, "holds").replaceOne({ _id: id }, next, {
      upsert: true,
      session,
    });
    await event(s, session, tripId);
    const result = { hold: seatIds.length ? next : null };
    await col(s, "idempotency").insertOne(
      { _id: idemId, hash, result, createdAt: time },
      { session },
    );
    return result;
  });
}
export async function snapshot(s: Store, tripId: string, userId?: string) {
  const [seats, time, h] = await Promise.all([
    col(s, "seats").find({ tripId }).sort({ seatId: 1 }).toArray(),
    now(s),
    userId ? col(s, "holds").findOne({ userId, tripId, active: true }) : null,
  ]);
  return {
    serverNow: time,
    seats: seats.map((x) => {
      const state =
        x.state === "HELD" && x.expiresAt <= time ? "AVAILABLE" : x.state;
      return {
        seatId: x.seatId,
        version: x.version,
        expiresAt: x.expiresAt,
        state,
        gender: state === "AVAILABLE" ? null : (x.gender ?? null),
        mine:
          x.holdId === h?._id &&
          x.expiresAt &&
          x.expiresAt > time,
      };
    }),
    hold: h && h.expiresAt > time ? h : null,
  };
}
export async function startPayment(
  s: Store,
  userId: string,
  holdId: string,
  passengers: any[],
  contact: string,
  mode: string,
  notificationEmail = "",
) {
  return transaction(s, async (session) => {
    const existing = await col(s, "orders").findOne(
      { _id: holdId, userId },
      { session },
    );
    if (existing) return existing;
    const h = await col(s, "holds").findOne(
      {
        _id: holdId,
        userId,
        active: true,
        state: "ACTIVE",
        $expr: { $gt: ["$expiresAt", "$$NOW"] },
      },
      { session },
    );
    if (!h)
      throw new AppError(
        410,
        "Your seat hold has expired. Please select seats again.",
      );
    if (passengers.length !== h.seatIds.length)
      throw new AppError(400, "Enter details for every passenger.");

    const normalizedPassengers = passengers.map((passenger, index) => {
      const seatId = h.seatIds[index];
      const lockedGender = h.seatGenders?.[seatId] as
        | PassengerGender
        | undefined;
      const providedGender = passenger.gender as PassengerGender | undefined;
      const gender = providedGender ?? lockedGender;
      if (!gender || (lockedGender && gender !== lockedGender))
        throw new AppError(
          409,
          `Passenger gender for seat ${seatId} must match the gender selected with that seat.`,
          "PASSENGER_GENDER_MISMATCH",
        );
      return { ...passenger, gender };
    });

    await col(s, "holds").updateOne(
      { _id: holdId, state: "ACTIVE" },
      {
        $set: {
          state: "PAYMENT_PENDING",
          passengers: normalizedPassengers,
          contact,
          notificationEmail: notificationEmail.trim().toLowerCase(),
        },
      },
      { session },
    );
    const order = {
      _id: holdId,
      userId,
      amount: h.amount,
      currency: "INR",
      mode,
      status: mode === "sandbox" ? "READY" : "CREATING",
      providerOrderId: mode === "sandbox" ? `sandbox_${holdId}` : null,
      createdAt: new Date(),
    };
    await col(s, "orders").insertOne(order, { session });
    return order;
  });
}
export async function finalize(
  s: Store,
  holdId: string,
  providerId: string,
  amount: number,
  currency: string,
) {
  return transaction(s, async (session) => {
    const old = await col(s, "payments").findOne({ providerId }, { session });
    if (old)
      return {
        status: old.outcome,
        booking: await col(s, "bookings").findOne(
          { holdId: old.holdId },
          { session },
        ),
      };
    const order = await col(s, "orders").findOne({ _id: holdId }, { session });
    if (!order || order.amount !== amount || currency !== "INR")
      throw new AppError(
        400,
        "Payment amount or currency does not match this order",
      );
    const h = await col(s, "holds").findOne({ _id: holdId }, { session });
    if (!h) throw new AppError(404, "Reservation not found");
    const confirmed = await col(s, "bookings").findOne({ holdId }, { session });
    const time = await now(s, session);
    let eligible =
      !confirmed &&
      h.active &&
      h.state === "PAYMENT_PENDING" &&
      h.expiresAt > time;
    if (eligible) {
      const count = await col(s, "seats").countDocuments(
        {
          holdId,
          state: "HELD",
          seatId: { $in: h.seatIds },
          $expr: { $gt: ["$expiresAt", "$$NOW"] },
        },
        { session },
      );
      eligible = count === h.seatIds.length;
    }
    if (!eligible) {
      await col(s, "payments").insertOne(
        {
          _id: randomUUID(),
          providerId,
          holdId,
          amount,
          currency,
          outcome: "REFUND_PENDING",
          createdAt: time,
        },
        { session },
      );
      await col(s, "refunds").insertOne(
        {
          _id: providerId,
          holdId,
          userId: h.userId,
          amount,
          mode: order.mode,
          status: "PENDING",
          attempts: 0,
          nextAttemptAt: time,
          createdAt: time,
        },
        { session },
      );
      if (h.active && !confirmed) await expire(s, h, session);
      return { status: "REFUND_PENDING", booking: null };
    }
    const result = await col(s, "seats").updateMany(
      {
        holdId,
        state: "HELD",
        seatId: { $in: h.seatIds },
        $expr: { $gt: ["$expiresAt", "$$NOW"] },
      },
      {
        $set: { state: "BOOKED", bookingId: holdId, expiresAt: null },
        $inc: { version: 1 },
      },
      { session },
    );
    if (result.modifiedCount !== h.seatIds.length)
      throw new AppError(
        409,
        "Hold changed during confirmation. Payment will be reconciled.",
      );
    const trip = await col(s, "trips").findOne({ _id: h.tripId }, { session });
    const booking = {
      _id: holdId,
      holdId,
      userId: h.userId,
      trip,
      seatIds: h.seatIds,
      passengers: h.passengers,
      contact: h.contact,
      notificationEmail: h.notificationEmail ?? "",
      familyBooking: !!h.familyBooking,
      amount,
      status: "CONFIRMED",
      reference: `HB-${randomUUID().slice(0, 8).toUpperCase()}`,
      createdAt: time,
      paymentMode: order.mode,
    };
    await col(s, "bookings").insertOne(booking, { session });
    await col(s, "holds").updateOne(
      { _id: holdId },
      { $set: { state: "CONFIRMED", active: false } },
      { session },
    );
    await col(s, "payments").insertOne(
      {
        _id: randomUUID(),
        providerId,
        holdId,
        amount,
        currency,
        outcome: "CONFIRMED",
        createdAt: time,
      },
      { session },
    );
    await col(s, "orders").updateOne(
      { _id: holdId },
      { $set: { status: "CAPTURED" } },
      { session },
    );
    await event(s, session, h.tripId);
    return { status: "CONFIRMED", booking };
  });
}
export function cancellationPolicy(booking: any, time: Date) {
  const departureAt = new Date(booking.trip?.departureAt);
  const ms = departureAt.getTime() - time.getTime();
  const hoursBefore = ms / 3600000;
  const status = booking.status ?? "CONFIRMED";

  if (status !== "CONFIRMED")
    return {
      allowed: false,
      refundPercent: 0,
      refundAmount: booking.refundAmount ?? 0,
      hoursBefore,
      reason: status === "CANCELLED" ? "This ticket is already cancelled." : "This ticket cannot be cancelled.",
    };

  if (!Number.isFinite(hoursBefore) || hoursBefore < 6)
    return {
      allowed: false,
      refundPercent: 0,
      refundAmount: 0,
      hoursBefore,
      reason: "Online cancellation closes 6 hours before departure.",
    };

  const refundPercent = hoursBefore >= 24 ? 100 : 50;
  return {
    allowed: true,
    refundPercent,
    refundAmount: Math.floor((booking.amount * refundPercent) / 100),
    hoursBefore,
    reason:
      refundPercent === 100
        ? "100% refund when cancelled at least 24 hours before departure."
        : "50% refund when cancelled between 6 and 24 hours before departure.",
  };
}

export async function cancellationQuote(s: Store, booking: any) {
  return cancellationPolicy(booking, await now(s));
}

export async function cancelBooking(
  s: Store,
  userId: string,
  bookingId: string,
) {
  return transaction(s, async (session) => {
    const booking = await col(s, "bookings").findOne(
      { _id: bookingId, userId },
      { session },
    );
    if (!booking) throw new AppError(404, "Booking not found");

    const time = await now(s, session);
    const policy = cancellationPolicy(booking, time);
    if (!policy.allowed)
      throw new AppError(409, policy.reason, "CANCELLATION_CLOSED");

    const payment = await col(s, "payments").findOne(
      { holdId: booking.holdId, outcome: "CONFIRMED" },
      { session },
    );
    if (!payment?.providerId)
      throw new AppError(
        409,
        "The payment record is still being reconciled. Please try again shortly.",
        "PAYMENT_RECONCILING",
      );

    const changed = await col(s, "bookings").updateOne(
      { _id: bookingId, userId, status: "CONFIRMED" },
      {
        $set: {
          status: "CANCELLED",
          cancelledAt: time,
          refundPercent: policy.refundPercent,
          refundAmount: policy.refundAmount,
        },
      },
      { session },
    );
    if (!changed.modifiedCount)
      throw new AppError(409, "This ticket has already changed. Please refresh.");

    await col(s, "seats").updateMany(
      { bookingId, state: "BOOKED" },
      {
        $set: {
          state: "AVAILABLE",
          bookingId: null,
          holdId: null,
          expiresAt: null,
          gender: null,
        },
        $inc: { version: 1 },
      },
      { session },
    );

    await col(s, "holds").updateOne(
      { _id: booking.holdId },
      { $set: { state: "CANCELLED", active: false } },
      { session },
    );

    await col(s, "payments").updateOne(
      { _id: payment._id },
      { $set: { outcome: "REFUND_AWAITING_APPROVAL" } },
      { session },
    );

    await col(s, "refunds").updateOne(
      { _id: payment.providerId },
      {
        $setOnInsert: {
          holdId: booking.holdId,
          userId,
          mode: booking.paymentMode,
          createdAt: time,
          attempts: 0,
        },
        $set: {
          amount: policy.refundAmount,
          originalAmount: booking.amount,
          reason: "PASSENGER_CANCELLATION",
          status: "PENDING_APPROVAL",
          requestedAt: time,
          nextAttemptAt: time,
        },
      },
      { upsert: true, session },
    );

    await event(s, session, booking.trip._id);
    return {
      ok: true,
      status: "CANCELLED",
      refundPercent: policy.refundPercent,
      refundAmount: policy.refundAmount,
      refundStatus: "PENDING_APPROVAL",
      cancelledAt: time,
    };
  });
}

export async function cleanup(s: Store) {
  const expired = await col(s, "holds")
    .find({ active: true, $expr: { $lte: ["$expiresAt", "$$NOW"] } })
    .limit(100)
    .toArray();
  for (const h of expired)
    await transaction(s, async (session) => {
      const current = await col(s, "holds").findOne(
        { _id: h._id, active: true, $expr: { $lte: ["$expiresAt", "$$NOW"] } },
        { session },
      );
      if (current) await expire(s, current, session);
    });
}
