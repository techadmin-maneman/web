// The loss extent the site's booking form asks for, and the four rough windows
// its first version offered, which the leads it left still carry; with the words
// the design uses for each. Zoho shows ops the same words the customer picked.

export const VISIT_WINDOWS = ["weekday_am", "weekday_pm", "weekend_am", "weekend_pm"] as const;
export type VisitWindow = (typeof VISIT_WINDOWS)[number];

export const LOSS_EXTENTS = ["crown", "receding", "advanced"] as const;
export type LossExtent = (typeof LOSS_EXTENTS)[number];

export const WINDOW_NAMES: Readonly<Record<VisitWindow, string>> = {
  weekday_am: "Weekday morning",
  weekday_pm: "Weekday evening",
  weekend_am: "Weekend morning",
  weekend_pm: "Weekend evening",
};

export const LOSS_EXTENT_NAMES: Readonly<Record<LossExtent, string>> = {
  crown: "Crown thinning",
  receding: "Receding front",
  advanced: "Advanced",
};

/** Morning is 9 am to noon; evening is 4 to 8 pm, the app's evening window (docs/decisions/0040-phase-1-alignment.md). */
export const WINDOW_LABELS = ["before noon", "after four"] as const;
export type WindowLabel = (typeof WINDOW_LABELS)[number];

/** The end of the booked page's headline: "Thursday, 24 September, before noon." */
export function windowLabel(window: VisitWindow): WindowLabel {
  return window.endsWith("_am") ? "before noon" : "after four";
}
