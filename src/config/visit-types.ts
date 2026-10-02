// The four kinds of visit, and what FSM's catalogue holds for them (docs/decisions/0032-fsm-mirror.md). A kind is
// code: it decides the technician's steps, the booking rules and the fees. The services within a kind are ops', in
// the services table, each synced to FSM's catalogue by its own item (docs/decisions/0085-services-ops-can-edit.md).
//
// A consultation, a service visit and a replacement each have a standard service, which a booking that names none is
// for, on an FSM item named as the kind is. A first fit has none: it is sold only as one of the hair systems ops set
// up in the console, each on its own item.

export const VISIT_TYPES = ["consultation", "first_fit", "service", "replacement"] as const;
export type VisitType = (typeof VISIT_TYPES)[number];

/** What each kind of visit is called, as clients, technicians and ops read it. */
export const VISIT_TYPE_NAMES: Readonly<Record<VisitType, string>> = {
  consultation: "Consultation",
  first_fit: "First fit",
  service: "Service visit",
  replacement: "Replacement",
};

/**
 * The tier of a kind's standard service, which a booking that names none is for while it is offered, and the late
 * fees' tier. A first fit has no standard service: its booking always names the hair system.
 */
export const STANDARD_TIER = "standard";

/** The kinds with a standard service: every kind but the first fit. */
const STANDARD_KINDS = ["consultation", "service", "replacement"] as const satisfies readonly VisitType[];
export type StandardKind = (typeof STANDARD_KINDS)[number];

/** Whether a booking of this kind that names no service is for the kind's standard one. */
export const hasStandardService = (kind: VisitType): kind is StandardKind =>
  (STANDARD_KINDS as readonly VisitType[]).includes(kind);

/** Each standard service's item in FSM, by its name there: the kind's own name. */
export const FSM_STANDARD_ITEMS: readonly { readonly kind: StandardKind; readonly name: string }[] = STANDARD_KINDS.map(
  (kind) => ({ kind, name: VISIT_TYPE_NAMES[kind] }),
);

/** The part a fitted piece is recorded against in FSM, until the price book names the bases. */
export const FSM_BASE_PART_NAME = "Standard base";

/** The visit type of an FSM item named as a kind is named, or null for any other item. */
export function visitTypeOfService(name: string): VisitType | null {
  return VISIT_TYPES.find((type) => VISIT_TYPE_NAMES[type] === name) ?? null;
}
