// The Funnel page's words. No design draws it; every word here is ours.

/** The Zoho Analytics dashboards, built on the nightly reporting copy, each opened in a tab of its own. */
const DASHBOARDS = "https://analytics.zoho.in/workspace/568020000000002006/view/";

export const funnel = {
  title: "Funnel",
  period: "Over",
  periods: { "30": "The last 30 days", "90": "The last 90 days" },
  /** Beside the title: the days counted. */
  counted: (from: string, to: string) => `${from} to ${to}`,
  steps: {
    title: "From try-on to fit",
    tryons: "Try-ons",
    leads: "New clients",
    booked: "Booked a consultation",
    consulted: "Had a consultation",
    fitted: "Fitted",
  },
  /** A step as a share of the new clients: "12 · 40%". */
  share: (count: number, of: number) =>
    of === 0 ? String(count) : `${String(count)} · ${String(Math.round((count / of) * 100))}%`,
  channels: {
    title: "By channel",
    columns: ["Channel", "New clients", "Booked", "Had a consultation", "Fitted"],
    none: "No new clients in these days.",
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
