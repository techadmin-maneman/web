// The four kinds of visit, and the FSM catalogue items they are booked as
// (docs/decisions/0032-fsm-mirror.md). A kind is code: it decides the
// technician's steps, the booking rules and the fees. The services within a
// kind are ops', in the services table, each synced to FSM's catalogue by its
// own item (docs/decisions/0085-services-ops-can-edit.md). The names below are
// the items scripts/setup-fsm.ts made for each kind's standard service, which
// the mirror falls back on when an item is no service's of ours.

export const VISIT_TYPES = ["consultation", "first_fit", "service", "replacement"] as const;
export type VisitType = (typeof VISIT_TYPES)[number];

/**
 * The tier every kind has had from the start: the one the price book priced alone before services, the late fees'
 * tier, the one a booking that names none is for while it is offered, and the site's Standard column.
 */
export const STANDARD_TIER = "standard";

/** Each visit type's standard service item in FSM, by its name there. */
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
