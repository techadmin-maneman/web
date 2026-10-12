// What a month's target may be set for, city by city, on the console's Targets page
// (docs/decisions/0154-targets-and-reporting-access.md): the figures every scorecard sets plan beside actual. Each is a
// count, rupees before GST, or a percentage, as the dashboards read it.

export const TARGET_MEASURES = [
  { measure: "leads", unit: "count" },
  { measure: "consultations", unit: "count" },
  { measure: "new_clients", unit: "count" },
  { measure: "active_clients", unit: "count" },
  { measure: "revenue", unit: "rupees" },
  { measure: "cac", unit: "rupees" },
  { measure: "utilisation", unit: "percent" },
  { measure: "on_time", unit: "percent" },
] as const;

export type TargetMeasure = (typeof TARGET_MEASURES)[number]["measure"];

export const TARGET_MEASURE_NAMES = TARGET_MEASURES.map((each) => each.measure) as [TargetMeasure, ...TargetMeasure[]];

/** The most a target may be: a percentage to a hundred, anything else to a crore. */
export const mostFor = (measure: TargetMeasure): number =>
  TARGET_MEASURES.find((each) => each.measure === measure)?.unit === "percent" ? 100 : 10_000_000;
