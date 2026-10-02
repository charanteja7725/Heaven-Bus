export type SupportContact = {
  id: string;
  issue: string;
  keywords: string[];
  role: string;
  phone: string;
  priority: "normal" | "urgent";
};

export const supportDirectory: SupportContact[] = [
  {
    id: "refunds",
    issue: "Refunds, cancellations & money-back issues",
    keywords: ["refund", "money back", "cancel", "cancellation", "charged", "payment reversal"],
    role: "Refund & Payment Resolution Desk",
    phone: "1800-000-1001",
    priority: "normal",
  },
  {
    id: "seat-quality",
    issue: "Broken, damaged, dirty or uncomfortable seats",
    keywords: ["broken seat", "dirty seat", "uncomfortable seat", "seat quality", "recliner", "armrest", "damaged seat"],
    role: "Fleet Seat Quality Supervisor",
    phone: "1800-000-1002",
    priority: "normal",
  },
  {
    id: "rash-driving",
    issue: "Rash, unsafe or dangerous driving",
    keywords: ["rash", "rash driving", "dangerous driving", "speeding", "driver unsafe", "reckless"],
    role: "Road Safety Control",
    phone: "1800-000-1003",
    priority: "urgent",
  },
  {
    id: "delay",
    issue: "Bus delays, missed timings or long unscheduled stops",
    keywords: ["delay", "late", "bus late", "timing", "waiting", "unscheduled stop"],
    role: "Schedule & Route Control",
    phone: "1800-000-1004",
    priority: "normal",
  },
  {
    id: "cleaning",
    issue: "Cleaning, smell, waste or unhygienic bus conditions",
    keywords: ["clean", "cleaning", "dirty", "smell", "garbage", "waste", "hygiene"],
    role: "Onboard Hygiene Supervisor",
    phone: "1800-000-1005",
    priority: "normal",
  },
  {
    id: "electricity",
    issue: "Charging ports, lights, electrical sockets or power failures",
    keywords: ["electricity", "charging", "charger", "socket", "plug", "power", "light", "lights"],
    role: "Electrical & Amenities Support",
    phone: "1800-000-1006",
    priority: "normal",
  },
  {
    id: "toilet",
    issue: "Toilet or washroom cleanliness, water or usability problems",
    keywords: ["toilet", "washroom", "restroom", "bathroom", "water in toilet"],
    role: "Toilet & Sanitation Supervisor",
    phone: "1800-000-1007",
    priority: "normal",
  },
  {
    id: "safety",
    issue: "Missing safety equipment, emergency exits or unsafe conditions",
    keywords: ["safety", "seat belt", "fire extinguisher", "emergency exit", "unsafe", "safety measure"],
    role: "Passenger Safety Control",
    phone: "1800-000-1008",
    priority: "urgent",
  },
  {
    id: "harassment",
    issue: "Harassment, threatening behaviour or women/passenger safety",
    keywords: ["harassment", "threat", "women safety", "passenger safety", "misbehaviour", "assault"],
    role: "Passenger Protection & Escalation",
    phone: "1800-000-1009",
    priority: "urgent",
  },
  {
    id: "medical",
    issue: "Medical emergency or passenger illness",
    keywords: ["medical", "sick", "ill", "emergency", "injury", "fainted", "health"],
    role: "Journey Emergency Desk",
    phone: "1800-000-1010",
    priority: "urgent",
  },
  {
    id: "luggage",
    issue: "Lost, missing, damaged or misplaced luggage",
    keywords: ["luggage", "bag", "baggage", "lost bag", "missing bag", "damaged luggage"],
    role: "Luggage Assistance Desk",
    phone: "1800-000-1011",
    priority: "normal",
  },
  {
    id: "boarding",
    issue: "Wrong boarding point, bus not found or boarding assistance",
    keywords: ["boarding", "pickup", "pick up", "bus not found", "boarding point", "missed bus"],
    role: "Boarding Coordination Desk",
    phone: "1800-000-1012",
    priority: "normal",
  },
  {
    id: "ac",
    issue: "Air-conditioning, ventilation or temperature problems",
    keywords: ["ac", "air conditioner", "air conditioning", "too hot", "too cold", "ventilation"],
    role: "Climate & Comfort Support",
    phone: "1800-000-1013",
    priority: "normal",
  },
  {
    id: "accessibility",
    issue: "Accessibility, elderly passenger or mobility assistance",
    keywords: ["wheelchair", "accessibility", "elderly", "mobility", "disabled", "special assistance"],
    role: "Accessibility Assistance Desk",
    phone: "1800-000-1014",
    priority: "normal",
  },
  {
    id: "tracking",
    issue: "Live bus location or journey tracking not updating",
    keywords: ["tracking", "live location", "bus location", "where is bus", "gps", "location not updating"],
    role: "Live Journey Tracking Desk",
    phone: "1800-000-1015",
    priority: "normal",
  },
  {
    id: "staff",
    issue: "Driver, conductor or staff behaviour complaints",
    keywords: ["driver", "conductor", "staff", "rude", "behaviour", "behavior", "complaint"],
    role: "Crew Conduct & Grievance Desk",
    phone: "1800-000-1016",
    priority: "normal",
  },
  {
    id: "general",
    issue: "Other journey or service complaints",
    keywords: ["complaint", "support", "help", "issue", "problem", "other"],
    role: "Passenger Help & Escalation Desk",
    phone: "1800-000-1099",
    priority: "normal",
  },
];

export function findSupportContacts(message: string) {
  const text = message.toLowerCase();
  const matches = supportDirectory.filter((entry) =>
    entry.keywords.some((keyword) => text.includes(keyword)),
  );
  if (matches.length) return matches.slice(0, 4);
  if (
    /contact|mobile number|phone number|customer care|helpline|support number|help desk/.test(
      text,
    )
  )
    return supportDirectory.filter((entry) => entry.id === "general");
  return [];
}

export const supportDisclaimer =
  "HEAVEN-BUS demo support numbers are placeholders for project testing and must be replaced with real operator contacts before commercial use.";
