import { col, transaction, type Store } from "./db.js";
export const cities = [
  "Bengaluru",
  "Chennai",
  "Hyderabad",
  "Mumbai",
  "Pune",
  "Goa",
  "Madurai",
  "Coimbatore",
];

export async function seed(s: Store) {
  const routes = [
    ["Bengaluru", "Chennai", 6.5, 699],
    ["Bengaluru", "Hyderabad", 9, 1099],
    ["Bengaluru", "Goa", 11, 1399],
    ["Chennai", "Madurai", 7, 799],
    ["Chennai", "Coimbatore", 8, 899],
    ["Mumbai", "Pune", 3.5, 449],
    ["Hyderabad", "Chennai", 11, 1199],
    ["Pune", "Goa", 10, 999],
  ] as const;
  const base = new Date(
    new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) +
      "T00:00:00+05:30",
  );
  const trips: any[] = [];
  for (let day = 0; day < 14; day++)
    for (const [a, b, duration, fare] of routes)
      for (const reverse of [false, true])
        for (let service = 0; service < 2; service++) {
          const from = reverse ? b : a,
            to = reverse ? a : b;
          const departure = new Date(
            base.getTime() + day * 86400000 + (service ? 21 : 8) * 3600000,
          );
          const date = new Date(departure.getTime() + 19800000)
            .toISOString()
            .slice(0, 10);
          trips.push({
            _id: `${from}-${to}-${date}-${service}`,
            from,
            to,
            date,
            departureAt: departure,
            arrivalAt: new Date(departure.getTime() + duration * 3600000),
            duration,
            fare: (fare + service * 200) * 100,
            name: service ? "Heaven Nightline" : "Heaven Express",
            type: service ? "AC Premium Seater" : "AC Seater",
            amenities: ["Air conditioning", "Charging port", "Water bottle"],
            status: "PUBLISHED",
            seats: 40,
            demo: true,
          });
        }
  // Batched transactions avoid thousands of network round trips. Repeated seeding
  // also repairs interrupted old seeds; $setOnInsert preserves all existing holds
  // and bookings. A published new trip and its inventory commit together.
  for (let offset = 0; offset < trips.length; offset += 32) {
    const batch = trips.slice(offset, offset + 32);
    await transaction(s, async (session) => {
      await col(s, "seats").bulkWrite(
        batch.flatMap((trip) =>
          Array.from({ length: 40 }, (_, i) => {
            const seatId = `${Math.floor(i / 4) + 1}${"ABCD"[i % 4]}`;
            return {
              updateOne: {
                filter: { tripId: trip._id, seatId },
                update: {
                  $setOnInsert: {
                    _id: `${trip._id}:${i}`,
                    tripId: trip._id,
                    seatId,
                    state: "AVAILABLE",
                    holdId: null,
                    expiresAt: null,
                    version: 0,
                  },
                },
                upsert: true,
              },
            };
          }),
        ),
        { session },
      );
      await col(s, "trips").bulkWrite(
        batch.map((trip) => ({
          updateOne: {
            filter: { _id: trip._id },
            update: { $setOnInsert: trip },
            upsert: true,
          },
        })),
        { session },
      );
    });
  }
}
