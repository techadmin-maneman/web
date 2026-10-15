// Where each record is, for staff access by place (src/policy/access.ts): a city, found through a pincode
// (serviceable_pincodes.city). A record whose city cannot be found is reached only by a national grant.
//
// Each record's city is an SQL expression over its row, so a list can keep to the caller's cities in the query that
// reads it. The subqueries name their tables `place_…`, so they never shadow the alias of the row they read.

import type { PlacesReached } from "../../policy/access.ts";

const pincodeCity = (pincode: string): string =>
  `(SELECT place_pin.city FROM serviceable_pincodes place_pin WHERE place_pin.pincode = ${pincode})`;

/**
 * A visit's city, `row` its alias: the one definition access, stock, the dispatch board and Books read. It is the city
 * its booking was made in, which booking copies from the pincode (appointments.service_city), so a pincode ops re-map
 * later leaves the visits booked there where they were; a visit booked before the copy was kept falls back to its
 * pincode's city now.
 */
export const visitCity = (row: string): string =>
  `COALESCE(${row}.service_city, ${pincodeCity(`${row}.service_pincode`)})`;

/** The city of the visit `appointmentId`. */
const cityOfVisit = (appointmentId: string): string =>
  `(SELECT ${visitCity("place_visit")} FROM appointments place_visit WHERE place_visit.id = ${appointmentId})`;

const currentAddressPincode = (personId: string): string =>
  `(SELECT place_address.pincode FROM addresses place_address
    WHERE place_address.person_id = ${personId} AND place_address.replaced_at IS NULL
    ORDER BY place_address.created_at DESC LIMIT 1)`;

const latestVisitPincode = (personId: string): string =>
  `(SELECT place_last_visit.service_pincode FROM appointments place_last_visit
    WHERE place_last_visit.person_id = ${personId} AND place_last_visit.deleted_at IS NULL
      AND place_last_visit.service_pincode IS NOT NULL
    ORDER BY place_last_visit.window_start DESC LIMIT 1)`;

const latestHoldPincode = (personId: string): string =>
  `(SELECT place_hold.pincode FROM slot_holds place_hold
    WHERE place_hold.person_id = ${personId} AND place_hold.pincode IS NOT NULL
    ORDER BY place_hold.created_at DESC LIMIT 1)`;

const latestConsultationPincode = (personId: string): string =>
  `(SELECT place_ask.pincode FROM consultation_requests place_ask
    WHERE place_ask.person_id = ${personId} ORDER BY place_ask.created_at DESC LIMIT 1)`;

const latestWaitlistPincode = (personId: string): string =>
  `(SELECT place_wait.pincode FROM waitlist_entries place_wait
    WHERE place_wait.person_id = ${personId} ORDER BY place_wait.created_at DESC LIMIT 1)`;

/**
 * A client's city: their current address's; before they have one, their latest visit's, then the pincode they last
 * booked at, asked for a consultation at, or joined the waitlist with. The first of these in one of our cities wins.
 */
function clientCity(personId: string): string {
  const pincodes = [
    currentAddressPincode(personId),
    latestVisitPincode(personId),
    latestHoldPincode(personId),
    latestConsultationPincode(personId),
    latestWaitlistPincode(personId),
  ];
  return `COALESCE(${pincodes.map(pincodeCity).join(", ")})`;
}

/** A hold's city: the pincode it was booked at, else the city of the visit it moves. */
const holdCity = (row: string): string =>
  `COALESCE(${pincodeCity(`${row}.pincode`)}, ${cityOfVisit(`${row}.moves_appointment_id`)})`;

const orderPincode = (orderId: string): string =>
  `(SELECT place_order.pincode FROM slot_holds place_order WHERE place_order.razorpay_order_id = ${orderId})`;

/** A payment's city: its visit's, else the hold it paid for, else its client's. */
const paymentCity = (row: string): string =>
  `COALESCE(${cityOfVisit(`${row}.appointment_id`)}, ${pincodeCity(orderPincode(`${row}.razorpay_order_id`))},
    ${clientCity(`${row}.person_id`)})`;

const caseVisit = (caseId: string): string =>
  `(SELECT place_case.appointment_id FROM no_show_cases place_case WHERE place_case.id = ${caseId})`;

interface RecordPlace {
  /** The table its rows are in, each keyed by `id`. */
  readonly table: string;
  /** Its city, as an SQL expression over the alias of its row; NULL where none can be found. */
  readonly city: (row: string) => string;
}

/** Every kind of record a member of staff may be kept to their own cities for. */
const RECORD_PLACES = {
  client: { table: "people", city: (row) => clientCity(`${row}.id`) },
  visit: { table: "appointments", city: visitCity },
  hold: { table: "slot_holds", city: holdCity },
  payment: { table: "payments", city: paymentCity },
  refund: {
    table: "refunds",
    city: (row) => `(SELECT ${paymentCity("place_payment")} FROM payments place_payment
      WHERE place_payment.id = ${row}.payment_id)`,
  },
  move: { table: "dispatch_moves", city: (row) => cityOfVisit(`${row}.appointment_id`) },
  move_proposal: { table: "move_proposals", city: (row) => cityOfVisit(`${row}.appointment_id`) },
  payment_link: { table: "payment_links", city: (row) => cityOfVisit(`${row}.appointment_id`) },
  piece: { table: "pieces", city: (row) => clientCity(`${row}.person_id`) },
  no_show: { table: "no_show_cases", city: (row) => cityOfVisit(`${row}.appointment_id`) },
  dispute: { table: "no_show_disputes", city: (row) => cityOfVisit(caseVisit(`${row}.case_id`)) },
  grievance: { table: "grievances", city: (row) => clientCity(`${row}.person_id`) },
  number_change: { table: "number_change_requests", city: (row) => clientCity(`${row}.person_id`) },
  deletion_request: { table: "deletion_requests", city: (row) => clientCity(`${row}.person_id`) },
  referral: { table: "referral_attributions", city: (row) => clientCity(`${row}.referred_person_id`) },
  consultation_request: { table: "consultation_requests", city: (row) => pincodeCity(`${row}.pincode`) },
  waitlist_entry: { table: "waitlist_entries", city: (row) => pincodeCity(`${row}.pincode`) },
  technician: { table: "technicians", city: (row) => `${row}.city` },
  visit_change: { table: "visit_changes", city: (row) => cityOfVisit(`${row}.appointment_id`) },
  // A chat's is its client's; a number we don't know is in no city.
  conversation: { table: "conversations", city: (row) => clientCity(`${row}.person_id`) },
  // A City matter's is the city it was sent to.
  city_matter: { table: "city_matters", city: (row) => `${row}.city` },
  remedy: { table: "remedies", city: (row) => clientCity(`${row}.person_id`) },
} satisfies Record<string, RecordPlace>;

export type PlacedRecord = keyof typeof RECORD_PLACES;

/** A record's city, as an SQL expression over the alias of its row, as `record` in `FROM grievances record`. */
function cityOfRow(kind: PlacedRecord, row: string): string {
  return RECORD_PLACES[kind].city(row);
}

/** The city of the client in the row named, as SQL: their address's, else where they last booked or asked to be told. */
export const clientCityOf = (row: string): string => cityOfRow("client", row);

/** The city a record is in; null where none can be found, or there is no such record. */
export async function cityOf(db: D1Database, kind: PlacedRecord, id: string): Promise<string | null> {
  const { table } = RECORD_PLACES[kind];
  const city = await db
    .prepare(`SELECT ${cityOfRow(kind, "record")} AS city FROM ${table} record WHERE record.id = ?1`)
    .bind(id)
    .first<string | null>("city");
  return city ?? null;
}

/** The technicians within reach, by ID; null when the reach is everywhere, so every one is. */
export async function techniciansWithin(db: D1Database, reached: PlacesReached): Promise<ReadonlySet<string> | null> {
  if (reached.kind === "everywhere") return null;
  const { results } = await db
    .prepare("SELECT id FROM technicians WHERE city IN (SELECT value FROM json_each(?1))")
    .bind(reachBinding(reached))
    .all<{ id: string }>();
  return new Set(results.map((row) => row.id));
}

/** Whether a technician is among those within reach, where null is every one. */
export function isWithin(technicians: ReadonlySet<string> | null, technicianId: string | null): boolean {
  if (technicians === null) return true;
  return technicianId !== null && technicians.has(technicianId);
}

/**
 * An SQL condition that keeps the rows within reach, with `param` bound to `reachBinding(reached)`. A row whose city
 * cannot be found is kept only everywhere.
 */
export function withinReach(kind: PlacedRecord, row: string, param: string): string {
  return `(${param} IS NULL OR ${cityOfRow(kind, row)} IN (SELECT value FROM json_each(${param})))`;
}

/**
 * The same condition for a record named by its id alone, `id` an SQL expression, as a list read from elsewhere carries
 * it.
 */
export function idWithinReach(kind: PlacedRecord, id: string, param: string): string {
  const { table } = RECORD_PLACES[kind];
  const city = `(SELECT ${cityOfRow(kind, "place_record")} FROM ${table} place_record WHERE place_record.id = ${id})`;
  return `(${param} IS NULL OR ${city} IN (SELECT value FROM json_each(${param})))`;
}

/** Null for everywhere, else the cities as a JSON list. */
export function reachBinding(reached: PlacesReached): string | null {
  if (reached.kind === "everywhere") return null;
  return JSON.stringify([...reached.cities]);
}
