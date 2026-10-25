// The settings of stock, purchasing and the supply plan, in the Rules table of ./ops-settings.ts: what the stock alerts
// and reports read, how often each class is counted, tomorrow's kits, when an order needs a second approver, when a
// custom order is late, and how often, how far ahead and on what assumptions the forecast runs.

import { CYCLE_COUNT_KEYS, CYCLE_COUNTS, type CycleCounts } from "./cycle-counts.ts";
import {
  FORECAST_ASSUMPTION_KEYS,
  FORECAST_ASSUMPTIONS,
  PLANNING_HORIZON_PERIODS,
  PLANNING_PERIOD_DAYS,
} from "./forecast.ts";
import { KIT_CHECK, KIT_CHECK_KEYS } from "./kit-check.ts";
import type { OpsSetting } from "./ops-settings.ts";
import { CUSTOM_ORDER_GRACE_DAYS, PO_RUPEES_TO_ONE, PO_SECOND_APPROVAL_ABOVE_RUPEES } from "./purchasing.ts";
import { STOCK_WATCH, STOCK_WATCH_KEYS } from "./stock.ts";
import { STOCK_QUALITY, STOCK_QUALITY_KEYS } from "./stock-quality.ts";
import { STOCK_USAGE, STOCK_USAGE_KEYS } from "./stock-usage.ts";
import { SCORECARD_DAYS } from "./supplier-scorecard.ts";
import { DAY_OF_WEEK, HOUR_OF_DAY } from "../config/setting-units.ts";

/** A class counted at least as often as the next: weekly before monthly, monthly before quarterly. */
const countConflicts = (days: CycleCounts): (readonly [string, string])[] => [
  ...(days.monthly < days.weekly ? [["monthly", "weekly"] as const] : []),
  ...(days.quarterly < days.monthly ? [["quarterly", "monthly"] as const] : []),
];

export const STOCK_SETTINGS = [
  {
    // The morning's stock alerts and the demand preview (docs/decisions/0158).
    name: "stock_watch",
    title: "Stock alerts",
    note: "When a lot about to expire is flagged, how far ahead demand is read, and when a transfer still on its way is flagged.",
    unit: "days",
    min: 1,
    max: 180,
    keys: STOCK_WATCH_KEYS,
    bounds: {
      expiry_warning_days: { min: 1, max: 180 },
      demand_days: { min: 7, max: 90 },
      transfer_overdue_days: { min: 1, max: 60 },
    },
    fallback: STOCK_WATCH,
  },
  {
    // Usage against expected (docs/decisions/0186-usage-and-shrinkage.md).
    name: "stock_usage",
    title: "Usage flags",
    note: "The days the Usage page reads, when a technician's use is flagged as running over, and when a kit's write-offs are.",
    unit: "days",
    min: 1,
    max: 365,
    keys: STOCK_USAGE_KEYS,
    bounds: {
      days: { min: 7, max: 365 },
      over_percent: { min: 1, max: 200, unit: "per cent" },
      min_visits: { min: 1, max: 100, unit: "visits" },
      write_offs: { min: 1, max: 50, unit: "write-offs" },
    },
    fallback: STOCK_USAGE,
  },
  {
    // Failure rates and value at risk (docs/decisions/0188-failure-rates-and-value-at-risk.md).
    name: "stock_quality",
    title: "Quality figures",
    note: "The days of fits the failure rates count, and the days of use a place's pace is read over.",
    unit: "days",
    min: 7,
    max: 1095,
    keys: STOCK_QUALITY_KEYS,
    bounds: {
      failure_days: { min: 30, max: 1095 },
      pace_days: { min: 7, max: 180 },
    },
    fallback: STOCK_QUALITY,
  },
  {
    // Cycle counts (docs/decisions/0185-cycle-counts.md).
    name: "cycle_counts",
    title: "Cycle counts",
    note: "Days between counts of each class at a place, and the share of what was held past which a consumable is counted again.",
    unit: "days",
    min: 0,
    max: 365,
    keys: CYCLE_COUNT_KEYS,
    bounds: {
      weekly: { min: 1, max: 60 },
      monthly: { min: 7, max: 120 },
      quarterly: { min: 30, max: 365 },
      recount_above_percent: { min: 0, max: 100, unit: "per cent" },
    },
    fallback: CYCLE_COUNTS,
    conflicts: (value) => countConflicts(value),
  },
  {
    // Tomorrow's kits (docs/decisions/0181-tomorrows-kits.md, 0184-the-one-visit-range.md).
    name: "kit_check",
    title: "Tomorrow's kits",
    note: "When the evening's kit check starts, how many hair systems a kit with a one visit tomorrow carries, and the evening it tops each kit up for the week.",
    unit: HOUR_OF_DAY,
    min: 0,
    max: 22,
    keys: KIT_CHECK_KEYS,
    bounds: {
      from_hour: { min: 12, max: 22 },
      one_visit_range: { min: 0, max: 20, unit: "hair systems" },
      top_up_weekday: { min: 0, max: 6, unit: DAY_OF_WEEK },
    },
    fallback: KIT_CHECK,
  },
  {
    // The supplier scorecard (docs/decisions/0172-supplier-scorecard.md).
    name: "scorecard_days",
    title: "Supplier scorecard",
    note: "How far back a supplier's scorecard reads their orders, receipts and claims.",
    unit: "days",
    min: 30,
    max: 1095,
    keys: null,
    fallback: SCORECARD_DAYS,
  },
  {
    // Purchase orders (docs/decisions/0166-purchase-orders.md).
    name: "po_second_approval_above_rupees",
    title: "Second approver for orders above",
    note: "A purchase order worth more than this in rupees needs a second Operations manager to approve it; one in another currency is judged at its rate below. Nought means every order needs two.",
    unit: "rupees",
    min: 0,
    max: 100_000_000,
    keys: null,
    fallback: PO_SECOND_APPROVAL_ABOVE_RUPEES,
  },
  {
    name: "po_rupees_to_one",
    title: "Exchange rates, for approvals",
    note: "By currency code, as USD: what one unit is worth in rupees when an order in it is judged against Second approver for orders above. Nought: such an order always needs two approvers.",
    unit: "rupees",
    min: 0,
    max: 10_000,
    keys: "open",
    fallback: PO_RUPEES_TO_ONE,
  },
  {
    // Custom orders (docs/decisions/0176-custom-order-refunds.md).
    name: "custom_order_grace_days",
    title: "A custom order is late, past its promised date, after",
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
    title: "Forecast ahead by",
    note: "How many planning periods ahead the forecast looks. Keep it longer than the longest supplier lead time and one period, or the plan cannot see past what is already on order.",
    unit: "periods",
    min: 1,
    max: 52,
    keys: null,
    fallback: PLANNING_HORIZON_PERIODS,
  },
  {
    name: "forecast_assumptions",
    title: "Forecast assumptions",
    note: "What the baseline averages, how far back rates are learned and from how many cases, and the rates assumed until then.",
    unit: "days",
    min: 0,
    max: 730,
    keys: FORECAST_ASSUMPTION_KEYS,
    bounds: {
      baseline_periods: { min: 1, max: 52, unit: "periods" },
      learning_days: { min: 28, max: 730 },
      enough_to_learn: { min: 1, max: 100, unit: "cases" },
      due_booking_percent: { min: 0, max: 100, unit: "per cent" },
      consultation_fit_percent: { min: 0, max: 100, unit: "per cent" },
      consultation_to_fit_days: { min: 0, max: 90 },
    },
    fallback: FORECAST_ASSUMPTIONS,
  },
] as const satisfies readonly OpsSetting[];
