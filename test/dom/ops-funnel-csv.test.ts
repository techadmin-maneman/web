// The Funnel page's CSV (apps/ops/src/funnel/funnel-csv.ts; docs/decisions/0324-the-weekly-dashboard.md): the header,
// a row a channel and the total, the money and the steps to fitted together, amounts in whole rupees.

import { describe, expect, it } from "vitest";
import type { Acquisition } from "../../apps/ops/src/funnel/funnel-api.ts";
import { funnelCsvRows } from "../../apps/ops/src/funnel/funnel-csv.ts";
import { funnel } from "../../apps/ops/src/content/funnel.ts";

const STEPS = {
  fitted: 2,
  no_shows: 1,
  leads_fitted: 1,
  first_reply_minutes: 7,
  tiers: [
    { tier: "premium", clients: 1 },
    { tier: "standard", clients: 1 },
  ],
  lost: [{ reason: "The price", clients: 2 }],
};

const GOOGLE = {
  channel: "google_ads" as const,
  spend: 5_000_000,
  leads: 6,
  consults_booked: 4,
  consults_done: 3,
  first_fits: 2,
  first_fit_revenue: 6_000_000,
  steps: STEPS,
};

const FIGURES: Acquisition = {
  period: "week",
  from: "2026-11-23",
  to: "2026-11-29",
  by: "first",
  rows: [GOOGLE],
  totals: { ...GOOGLE },
  cohorts: [],
  cohort_complete: { d30: false, d90: false, d180: false },
  heard: [],
  tryons: 0,
};

describe("the funnel's CSV", () => {
  it("writes the header, each channel and the total, each figure in its column", () => {
    const rows = funnelCsvRows(FIGURES);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual([...funnel.csv.columns]);
    const google = Object.fromEntries(funnel.csv.columns.map((column, index) => [column, rows[1]?.[index]]));
    expect(google).toMatchObject({
      Channel: "Google Ads",
      "Spend (Rs.)": "50000",
      Enquiries: "6",
      "Qualified (consultation booked)": "4",
      Attended: "3",
      Fitted: "2",
      "Cost per enquiry (Rs.)": "8333",
      "Cost per attended (Rs.)": "16667",
      "Close rate": "67%",
      "New clients fitted": "1",
      "Cost per new client fitted (Rs.)": "50000",
      "Tier mix": "Premium 1 · Standard 1",
      "First reply (min, Care hours)": "7",
      "No-shows": "1",
      "No-show rate": "25%",
      "Lost because": "The price 2",
    });
    expect(rows[2]?.[0]).toBe(funnel.channels.total);
  });
});
