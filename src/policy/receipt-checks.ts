// What a hair system is checked against as it arrives (docs/decisions/0169-supplier-claims.md): each point a failed
// piece names, which its claim on the supplier carries. Ops choose which they check in Settings › Purchasing.

export const QC_POINTS = ["base_size", "colour", "density", "lace_knots", "label"] as const;
export type QcPoint = (typeof QC_POINTS)[number];
export const QC_CHOICES = ["checked", "skipped"] as const;

/** Every point checked, until ops set otherwise. */
export const RECEIPT_CHECKS: Readonly<Record<QcPoint, string>> = {
  base_size: "checked",
  colour: "checked",
  density: "checked",
  lace_knots: "checked",
  label: "checked",
};

/** The points ops check, in their order. */
export const checkedPoints = (checks: Readonly<Record<string, string>>): QcPoint[] =>
  QC_POINTS.filter((point) => (checks[point] ?? RECEIPT_CHECKS[point]) === "checked");
