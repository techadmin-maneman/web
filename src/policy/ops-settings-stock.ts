// The settings of purchasing and the supply plan, in the Rules table of ./ops-settings.ts: when an order needs a second
// approver, when a custom order is late, and how often and how far ahead the forecast runs.

import { PLANNING_HORIZON_PERIODS, PLANNING_PERIOD_DAYS } from "./forecast.ts";
import type { OpsSetting } from "./ops-settings.ts";
import { CUSTOM_ORDER_GRACE_DAYS, PO_SECOND_APPROVAL_ABOVE_RUPEES } from "./purchasing.ts";

export const STOCK_SETTINGS = [
  {
    // Purchase orders (docs/decisions/0166-purchase-orders.md).
    name: "po_second_approval_above_rupees",
    title: "Second approver above",
    note: "A purchase order in rupees worth more than this needs a second Operations manager to approve it; one in another currency always does. Nought means every order needs two.",
    unit: "rupees",
    min: 0,
    max: 100_000_000,
    keys: null,
    fallback: PO_SECOND_APPROVAL_ABOVE_RUPEES,
  },
  {
    // Custom orders (docs/decisions/0176-custom-order-refunds.md).
    name: "custom_order_grace_days",
    title: "Custom order grace",
    note: "Days past the date a supplier promised a custom piece before it counts as late, and its client may have their money back in full.",
    unit: "days",
    min: 0,
    max: 90,
    keys: null,
    fallback: CUSTOM_ORDER_GRACE_DAYS,
  },
  {
    // The demand forecast and supply plan (docs/decisions/0179-demand-forecast.md).
    name: "planning_period_days",
    title: "Planning period",
    note: "How often the forecast runs and the supply plan drafts orders, and the days each forecast figure covers.",
    unit: "days",
    min: 1,
    max: 31,
    keys: null,
    fallback: PLANNING_PERIOD_DAYS,
  },
  {
    name: "planning_horizon_periods",
    title: "Forecast horizon",
    note: "How many planning periods ahead the forecast looks. Keep it longer than the longest supplier lead time and one period, or the plan cannot see past what is already on order.",
    unit: "periods",
    min: 1,
    max: 52,
    keys: null,
    fallback: PLANNING_HORIZON_PERIODS,
  },
] as const satisfies readonly OpsSetting[];
