export const API = (
  import.meta.env.VITE_API_URL ??
  (import.meta.env.PROD ? "https://heaven-bus-api.onrender.com" : "")
).replace(/\/$/, "");
export function getToken() {
  return sessionStorage.getItem("hb-token");
}
export async function api(path: string, options: RequestInit = {}) {
  const response = await fetch(`${API}/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      ...options.headers,
    },
    signal: options.signal ?? AbortSignal.timeout(25000),
  });
  const body = await response
    .json()
    .catch(() => ({
      message: "The server is starting. Please try again shortly.",
    }));
  if (!response.ok) throw new Error(body.message ?? "Something went wrong");
  return body;
}
export const money = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value / 100);
export const time = (value: string) =>
  new Date(value).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  });
export const dateLabel = (value: string) =>
  new Date(
    value.length === 10 ? `${value}T12:00:00+05:30` : value,
  ).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
export const today = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
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
export type Trip = {
  _id: string;
  from: string;
  to: string;
  date: string;
  departureAt: string;
  arrivalAt: string;
  duration: number;
  fare: number;
  name: string;
  type: string;
  available: number;
  amenities: string[];
};
export type PassengerGender = "MALE" | "FEMALE" | "OTHER";
export type Hold = {
  _id: string;
  tripId: string;
  seatIds: string[];
  seatGenders?: Record<string, PassengerGender>;
  expiresAt: string;
  amount: number;
  state: string;
  serverNow?: string;
  passengers?: {
    name: string;
    age: number;
    gender: PassengerGender;
  }[];
  contact?: string;
  order?: any;
  payment?: any;
  refunds?: any[];
};
export type User = { _id: string; name: string; email: string; role: string };
