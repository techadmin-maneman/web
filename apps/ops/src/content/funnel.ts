// The Funnel page's words (docs/decisions/0288-attribution-and-conversions.md). No design draws it; every word here is
// ours.

/** The Zoho Analytics dashboards, built on the nightly reporting copy, each opened in a tab of its own. */
const DASHBOARDS = "https://analytics.zoho.in/workspace/568020000000002006/view/";

export const funnel = {
  title: "Funnel",
  period: "Period",
  periods: { week: "Week", month: "Month" },
  starting: "Week or month of",
  by: "Channel by",
  bys: { first: "How the client found us", last: "Their last touch" },
  channel: "Channel",
  allChannels: "All channels",
  /** Beside the title: the days counted. */
  counted: (from: string, to: string) => `${from} to ${to}`,
  steps: {
    title: "From try-on to fit",
    tryons: "Try-ons",
    leads: "New clients",
    booked: "Booked a consultation",
    consulted: "Had a consultation",
    fitted: "First fits paid",
  },
  channels: {
    title: "By channel",
    columns: [
      "Channel",
      "Spend",
      "New clients",
      "Cost per client",
      "Consultations booked",
      "Consultations done",
      "Cost per consultation",
      "First fits",
      "Cost per fit",
      "First-fit revenue",
      "Return on spend",
    ] as const,
    total: "All channels",
    none: "Nothing in this period.",
  },
  /** Revenue for each rupee spent: "2.4×". */
  roas: (revenue: number, spend: number) => `${(revenue / spend).toFixed(1)}×`,
  cohorts: {
    title: "Revenue after the first fit",
    columns: ["Channel", "Clients fitted", "30 days", "90 days", "180 days"] as const,
    /** A span not yet over for every client in the cohort. */
    soFar: (amount: string) => `${amount} so far`,
    none: "No first fits in this period.",
  },
  heard: {
    title: "What clients told us",
    told: "They said",
    notAsked: "Not asked",
    none: "No consultations done in this period.",
  },
  dashboards: {
    title: "Dashboards",
    note: "Built on the nightly reporting copy, in Zoho Analytics.",
    links: [
      { name: "Growth", href: `${DASHBOARDS}568020000000043225` },
      { name: "Daily flash", href: `${DASHBOARDS}568020000000037490` },
      { name: "City scorecard", href: `${DASHBOARDS}568020000000037658` },
    ],
  },
};
