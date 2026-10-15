// What running a city costs a month (docs/cost-model.md): the vendors' prices in data/cost-model.json, each dated
// and sourced, against a city's month of visits, leads, try-ons, messages and seats. National lines, Cloudflare,
// Books, Supabase and Maps, are shared by every city, so a city carries its share of them by its visits.

import { readFileSync } from "node:fs";
import { z } from "zod";

const Basis = z.enum([
  "national",
  "per_seat",
  "per_utility_message",
  "per_authentication_message",
  "per_marketing_message",
  "per_render",
]);

const Line = z
  .object({
    id: z.string(),
    what: z.string(),
    basis: Basis,
    inr: z.number().nonnegative().optional(),
    usd: z.number().nonnegative().optional(),
    source: z.url(),
    note: z.string(),
  })
  .refine((line) => (line.inr === undefined) !== (line.usd === undefined), "a price in rupees or in dollars");

export const CostPrices = z.object({
  as_of: z.iso.date(),
  inr_per_usd: z.number().positive(),
  lines: z.array(Line).min(1),
});
export type CostPrices = z.infer<typeof CostPrices>;

export const readCostPrices = (): CostPrices =>
  CostPrices.parse(JSON.parse(readFileSync("data/cost-model.json", "utf8")));

/** A city's month, as the plan has it. */
export interface CityMonth {
  readonly visits: number;
  readonly leads: number;
  readonly renders: number;
  /** The city team's CRM seats. */
  readonly seats: number;
  /** The share of every city's visits that are this city's, 0 to 1: its part of the national lines. */
  readonly shareOfVisits: number;
  /** Utility messages a visit sends: its booking, a reminder, the arrival, a check-in. */
  readonly utilityPerVisit: number;
  /** Login codes a lead takes. */
  readonly codesPerLead: number;
  /** Marketing messages the city sends in the month: launch alerts, campaigns. */
  readonly marketing: number;
  /** Whether WhatsApp bills each message: on MSG91's WhatsApp Business Platform, not on the Evolution bridge. */
  readonly whatsappBilled: boolean;
}

export const CITY_MONTH_DEFAULTS = {
  utilityPerVisit: 4,
  codesPerLead: 1,
  marketing: 0,
  shareOfVisits: 1,
  whatsappBilled: true,
} as const;

const MESSAGES: ReadonlySet<string> = new Set([
  "per_utility_message",
  "per_authentication_message",
  "per_marketing_message",
]);

export interface CostLine {
  readonly id: string;
  readonly what: string;
  readonly quantity: number;
  readonly rupees: number;
}

function quantityOf(basis: z.infer<typeof Basis>, month: CityMonth): number {
  switch (basis) {
    case "national":
      return month.shareOfVisits;
    case "per_seat":
      return month.seats;
    case "per_utility_message":
      return month.visits * month.utilityPerVisit;
    case "per_authentication_message":
      return month.leads * month.codesPerLead;
    case "per_marketing_message":
      return month.marketing;
    case "per_render":
      return month.renders;
  }
}

/** Each line's month for the city, in rupees before GST, and their total and cost a visit. */
export function cityMonthCost(prices: CostPrices, month: CityMonth) {
  const lines: CostLine[] = prices.lines.map((line) => {
    const unbilled = MESSAGES.has(line.basis) && !month.whatsappBilled;
    const unit = unbilled ? 0 : (line.inr ?? (line.usd ?? 0) * prices.inr_per_usd);
    const quantity = quantityOf(line.basis, month);
    return { id: line.id, what: line.what, quantity, rupees: Math.round(unit * quantity * 100) / 100 };
  });
  const total = Math.round(lines.reduce((sum, line) => sum + line.rupees, 0) * 100) / 100;
  const perVisit = month.visits === 0 ? null : Math.round((total / month.visits) * 100) / 100;
  return { lines, total, perVisit };
}
