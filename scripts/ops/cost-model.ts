// A city's month, costed (docs/cost-model.md): each vendor's line from data/cost-model.json against the plan's visits,
// leads, try-on renders and seats, in rupees before GST. Run it when a city opens, or when a price changes.
//
//   node scripts/ops/cost-model.ts --visits 400 --leads 300 --renders 600 --seats 2 [--share 0.25] [--bridge]
//
// --share is the city's part of every city's visits, which it carries of the national lines; --bridge prices
// WhatsApp as the Evolution bridge, which bills nothing. Reads nothing remote; writes nothing.

import { parseArgs } from "node:util";
import { CITY_MONTH_DEFAULTS, cityMonthCost, readCostPrices } from "../lib/cost-model.ts";

const { values } = parseArgs({
  options: {
    visits: { type: "string", default: "0" },
    leads: { type: "string", default: "0" },
    renders: { type: "string", default: "0" },
    seats: { type: "string", default: "0" },
    share: { type: "string", default: String(CITY_MONTH_DEFAULTS.shareOfVisits) },
    marketing: { type: "string", default: String(CITY_MONTH_DEFAULTS.marketing) },
    bridge: { type: "boolean", default: false },
  },
});

const prices = readCostPrices();
const { lines, total, perVisit } = cityMonthCost(prices, {
  ...CITY_MONTH_DEFAULTS,
  visits: Number(values.visits),
  leads: Number(values.leads),
  renders: Number(values.renders),
  seats: Number(values.seats),
  shareOfVisits: Number(values.share),
  marketing: Number(values.marketing),
  whatsappBilled: !values.bridge,
});

const rupees = (amount: number) => `Rs. ${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
console.log(`A month's costs, at prices as of ${prices.as_of}, before GST:`);
for (const line of lines) console.log(`${rupees(line.rupees).padStart(16)}  ${line.what} (${String(line.quantity)})`);
console.log(`${rupees(total).padStart(16)}  in all${perVisit === null ? "" : `, ${rupees(perVisit)} a visit`}`);
