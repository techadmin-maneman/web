// Tomorrow's kits (docs/decisions/0181-tomorrows-kits.md, 0184-the-one-visit-range.md): when the evening's check
// starts, how many hair systems a kit with a one visit tomorrow carries, and the evening it tops kits up for the week.

export const KIT_CHECK_KEYS = ["from_hour", "one_visit_range", "top_up_weekday"] as const;
/**
 * The hour, in India, from which the evening's check runs, each hour until the day ends; and how many hair systems a
 * kit with a one visit tomorrow carries, one of each its city's forecast expects most; and the day of the week, 0 for
 * Sunday, whose evening check proposes each kit's consumables for the week ahead. Ops set them in Settings.
 */
export type KitCheck = Readonly<Record<(typeof KIT_CHECK_KEYS)[number], number>>;

export const KIT_CHECK: KitCheck = { from_hour: 17, one_visit_range: 5, top_up_weekday: 0 };
