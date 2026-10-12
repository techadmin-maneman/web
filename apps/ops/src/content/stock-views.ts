// The Stock page's totals by zone and city, and its list of what expires soon (docs/decisions/0159-stock-views-and-
// expiry.md). No design draws them; every word here is ours. Only those two read it, each loaded when shown.

export const stockViews = {
  totals: {
    national: "All places",
    noZone: "No zone",
    noCity: "No city",
  },
  expiring: {
    title: "Expiring",
    intro: (days: number) => `Lots expiring within ${String(days)} days, soonest first. Use them first or move them.`,
    columns: ["Consumable", "Lot", "Place", "How many", "Expires"],
    expired: "Expired",
  },
};
