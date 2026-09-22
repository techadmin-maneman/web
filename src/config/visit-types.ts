// The four kinds of visit, and the FSM catalogue items they are booked as
// (docs/decisions/0032-fsm-mirror.md). The mirror reads an appointment's type
// from its service item's name; scripts/setup-fsm.ts creates the items.

export const VISIT_TYPES = ["consultation", "first_fit", "service", "replacement"] as const;
export type VisitType = (typeof VISIT_TYPES)[number];

/** Each visit type's service item in FSM, by its name there. */
export const FSM_SERVICE_NAMES: Readonly<Record<VisitType, string>> = {
  consultation: "Consultation",
  first_fit: "First fit",
  service: "Service visit",
  replacement: "Replacement",
};

/** The part a fitted piece is recorded against in FSM, until the price book names the bases. */
export const FSM_BASE_PART_NAME = "Standard base";

/** The visit type whose service item has this name, or null for any other item. */
export function visitTypeOfService(name: string): VisitType | null {
  return VISIT_TYPES.find((type) => FSM_SERVICE_NAMES[type] === name) ?? null;
}
