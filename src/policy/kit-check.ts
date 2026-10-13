// Tomorrow's kits (docs/decisions/0181-tomorrows-kits.md, 0184-the-one-visit-range.md): when the evening's check
// starts, and how many hair systems a kit with a one visit tomorrow carries.

export const KIT_CHECK_KEYS = ["from_hour", "one_visit_range"] as const;
/**
 * The hour, in India, from which the evening's check runs, each hour until the day ends; and how many hair systems a
 * kit with a one visit tomorrow carries, one of each its city's forecast expects most. Ops set them in Settings.
 */
export type KitCheck = Readonly<Record<(typeof KIT_CHECK_KEYS)[number], number>>;

export const KIT_CHECK: KitCheck = { from_hour: 17, one_visit_range: 5 };
