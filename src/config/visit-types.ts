// The four kinds of visit. A kind is code: it decides the technician's steps, the booking rules and the fees. The
// services within a kind are ops', in the services table (docs/decisions/0085-services-ops-can-edit.md).
//
// A consultation, a service visit and a replacement each have a standard service, which a booking that names none is
// for. A first fit has none: it is sold only as one of the hair systems ops set up in the console.

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
type StandardKind = (typeof STANDARD_KINDS)[number];

/** Whether a booking of this kind that names no service is for the kind's standard one. */
export const hasStandardService = (kind: VisitType): kind is StandardKind =>
  (STANDARD_KINDS as readonly VisitType[]).includes(kind);
