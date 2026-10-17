// The Stock page's totals by zone and city, and its list of what expires soon (docs/decisions/0159-stock-views-and-
// expiry.md). No design draws them; every word here is ours. Only those two read it, each loaded when shown.

export const stockViews = {
  totals: {
    national: "All places",
    noZone: "No zone",
    noCity: "No city",
  },
  demand: {
    title: "Next 4 weeks",
    columns: ["Item", "City", "Booked visits use", "Held there"],
    none: "Nothing booked in the next four weeks uses stock.",
    noCity: "No city",
    noProfile: "No hair profile to match",
    short: (by: number) => `${String(by)} short`,
    atRisk: "Fits at risk",
    /** "Thu 24 Sep, Gurgaon: Mane Man Essential · 8 × 10 in · #1B · 20% grey · 100% density not in the city" */
    fit: (date: string, city: string, what: string) => `${date}, ${city}: ${what}`,
  },
  expiring: {
    title: "Expiring",
    within: (days: number) => `Within ${String(days)} days, soonest first`,
    columns: ["Item", "Lot", "Place", "How many", "Expires"],
    expired: "Expired",
  },
};
