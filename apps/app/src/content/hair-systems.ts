// Your hair system and the four compared (design/client-redesign, the piece and compare screens;
// docs/decisions/0253-replacement-when-due-and-change-of-hair-system.md).

export const hairSystems = {
  wearing: "Wearing now",
  fitted: "Fitted",
  life: "Life",
  lifeIs: (months: number, ends: string) => `${String(months)} months, ends ${ends}`,
  replacement: "Replacement",
  openNow: "Open now",
  opens: (date: string) => `Opens ${date}`,
  worn: "Every hair system you’ve worn",
  /** "14 Mar 2026 to now · 8 months". */
  span: (from: string, to: string | null, months: number) =>
    `${from} to ${to ?? "now"} · ${months === 1 ? "1 month" : `${String(months)} months`}`,
  fittingVisit: "Fitting visit",
  compare: "Compare the four hair systems",
  compareMeta: "You can change at each replacement",
  none: "No hair system on record yet.",
  /** The four compared. */
  lede: "Every hair system is fitted and serviced at home. The difference is the base.",
  ledeFitted: "You can change at each replacement.",
  ledeLead: "Your technician recommends one at your consultation.",
  firstFit: "First fit",
  replacementPrice: "Replacement",
  lasts: "Lasts",
  months: (months: number) => `${String(months)} months`,
  service: "Service",
  every: (days: number) => (days % 7 === 0 ? `every ${String(days / 7)} weeks` : `every ${String(days)} days`),
  gst: "Prices include GST.",
  failed: "We couldn’t load the hair systems.",
} as const;
