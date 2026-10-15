// The monthly cost model (scripts/lib/cost-model.ts, docs/cost-model.md): every price dated and sourced, and a city's
// month costed from its visits, leads, renders and seats.

import { describe, expect, it } from "vitest";
import { CITY_MONTH_DEFAULTS, cityMonthCost, readCostPrices } from "../../../scripts/lib/cost-model.ts";

const prices = readCostPrices();
const month = { ...CITY_MONTH_DEFAULTS, visits: 400, leads: 300, renders: 600, seats: 2, shareOfVisits: 0.25 };
const line = (id: string, lines: readonly { id: string; rupees: number }[]) => lines.find((each) => each.id === id);

describe("the cost model", () => {
  it("reads every price with the day it was read and where it came from", () => {
    expect(prices.lines.length).toBeGreaterThan(5);
    for (const each of prices.lines) expect(each.source, each.id).toMatch(/^https:\/\//);
  });

  it("costs each line by its basis: messages by visits and leads, renders, seats, and a share of the national", () => {
    const { lines } = cityMonthCost(prices, month);
    expect(line("whatsapp_utility", lines)?.rupees).toBe(184);
    expect(line("whatsapp_authentication", lines)?.rupees).toBe(34.5);
    expect(line("zoho_crm", lines)?.rupees).toBe(2800);
    expect(line("zoho_books", lines)?.rupees).toBe(374.75);
    expect(line("youcam", lines)?.rupees).toBe(Math.round(0.11 * prices.inr_per_usd * 600 * 100) / 100);
  });

  it("prices WhatsApp at nothing on the Evolution bridge, and gives the month's cost a visit", () => {
    const { lines, total, perVisit } = cityMonthCost(prices, { ...month, whatsappBilled: false });
    expect(line("whatsapp_utility", lines)?.rupees).toBe(0);
    expect(perVisit).toBe(Math.round((total / 400) * 100) / 100);
  });
});
