// Where each record is, for staff access by place (src/policy/access.ts): a city, found through a pincode
// (serviceable_pincodes.city). A record whose city cannot be found is reached only by a national grant.
//
// Each record's city is an SQL expression over its row, so a list can keep to the caller's cities in the query that
// reads it. The subqueries name their tables `place_…`, so they never shadow the alias of the row they read.

import type { PlacesReached } from "../policy/access.ts";

const pincodeCity = (pincode: string): string =>
  `(SELECT place_pin.city FROM serviceable_pincodes place_pin WHERE place_pin.pincode = ${pincode})`;

const visitPincode = (appointmentId: string): string =>
  `(SELECT place_visit.service_pincode FROM appointments place_visit WHERE place_visit.id = ${appointmentId})`;

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

/** A hold's city: the pincode it was booked at, else the address of the visit it moves. */
const holdCity = (row: string): string =>
  pincodeCity(`COALESCE(${row}.pincode, ${visitPincode(`${row}.moves_appointment_id`)})`);

const orderPincode = (orderId: string): string =>
  `(SELECT place_order.pincode FROM slot_holds place_order WHERE place_order.razorpay_order_id = ${orderId})`;

/** A payment's city: its visit's, else the hold it paid for, else its client's. */
const paymentCity = (row: string): string =>
  `COALESCE(${pincodeCity(visitPincode(`${row}.appointment_id`))}, ${pincodeCity(orderPincode(`${row}.razorpay_order_id`))},
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
  visit: { table: "appointments", city: (row) => pincodeCity(`${row}.service_pincode`) },
  hold: { table: "slot_holds", city: holdCity },
  payment: { table: "payments", city: paymentCity },
  refund: {
    table: "refunds",
    city: (row) => `(SELECT ${paymentCity("place_payment")} FROM payments place_payment
      WHERE place_payment.id = ${row}.payment_id)`,
  },
  move: { table: "dispatch_moves", city: (row) => pincodeCity(visitPincode(`${row}.appointment_id`)) },
  payment_link: { table: "payment_links", city: (row) => pincodeCity(visitPincode(`${row}.appointment_id`)) },
  piece: { table: "pieces", city: (row) => clientCity(`${row}.person_id`) },
  no_show: { table: "no_show_cases", city: (row) => pincodeCity(visitPincode(`${row}.appointment_id`)) },
  dispute: { table: "no_show_disputes", city: (row) => pincodeCity(visitPincode(caseVisit(`${row}.case_id`))) },
  grievance: { table: "grievances", city: (row) => clientCity(`${row}.person_id`) },
  number_change: { table: "number_change_requests", city: (row) => clientCity(`${row}.person_id`) },
  deletion_request: { table: "deletion_requests", city: (row) => clientCity(`${row}.person_id`) },
  referral: { table: "referral_attributions", city: (row) => clientCity(`${row}.referred_person_id`) },
  consultation_request: { table: "consultation_requests", city: (row) => pincodeCity(`${row}.pincode`) },
  waitlist_entry: { table: "waitlist_entries", city: (row) => pincodeCity(`${row}.pincode`) },
  technician: { table: "technicians", city: (row) => `${row}.city` },
  visit_change: { table: "visit_changes", city: (row) => pincodeCity(visitPincode(`${row}.appointment_id`)) },
} satisfies Record<string, RecordPlace>;

export type PlacedRecord = keyof typeof RECORD_PLACES;

/** A record's city, as an SQL expression over the alias of its row, as `record` in `FROM grievances record`. */
export function cityOfRow(kind: PlacedRecord, row: string): string {
  return RECORD_PLACES[kind].city(row);
}

/** The city a record is in; null where none can be found, or there is no such record. */
export async function cityOf(db: D1Database, kind: PlacedRecord, id: string): Promise<string | null> {
  const { table } = RECORD_PLACES[kind];
  const city = await db
    .prepare(`SELECT ${cityOfRow(kind, "record")} AS city FROM ${table} record WHERE record.id = ?1`)
    .bind(id)
    .first<string | null>("city");
  return city ?? null;
}

/** A record of a kind, by its ID. */
export interface PlacedId {
  readonly kind: PlacedRecord;
  readonly id: string;
}

const placedKey = (record: PlacedId): string => `${record.kind}/${record.id}`;

/**
 * The city of each record, read in one round trip: a statement for each kind, each record by its key. Null for one
 * whose city cannot be found.
 */
export async function citiesOf(
  db: D1Database,
  records: readonly PlacedId[],
): Promise<(record: PlacedId) => string | null> {
  const kinds = [...new Set(records.map((record) => record.kind))];
  const idsOf = (kind: PlacedRecord) => records.filter((record) => record.kind === kind).map((record) => record.id);
  const statements = kinds.map((kind) =>
    db
      .prepare(
        `SELECT record.id AS id, ${cityOfRow(kind, "record")} AS city FROM ${RECORD_PLACES[kind].table} record
         WHERE record.id IN (SELECT value FROM json_each(?1))`,
      )
      .bind(JSON.stringify(idsOf(kind))),
  );
  const answers = statements.length === 0 ? [] : await db.batch<{ id: string; city: string | null }>(statements);
  const cities = new Map<string, string | null>();
  answers.forEach((answer, index) => {
    const kind = kinds[index];
    if (kind === undefined) return;
    for (const row of answer.results) cities.set(placedKey({ kind, id: row.id }), row.city);
  });
  return (record) => cities.get(placedKey(record)) ?? null;
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

/** Null for everywhere, else the cities as a JSON list. */
export function reachBinding(reached: PlacesReached): string | null {
  if (reached.kind === "everywhere") return null;
  return JSON.stringify([...reached.cities]);
}
