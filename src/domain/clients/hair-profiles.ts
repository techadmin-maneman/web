// A client's hair profile (docs/decisions/0106-a-clients-hair-profile.md; src/policy/hair-profile.ts): every version
// of the fit spec and the history, the technician's and ops'.
//
// A version is the whole profile as it stood when it was recorded: the phone and the console each start from the
// latest and send it back whole, so the latest version is the profile, and a replacement is ordered to it. None is
// ever changed; an erasure blanks every one (migration 0064 holds the table to that).
//
// The history is health information, recorded with the fit spec. This file and the export are all
// that read it; nothing here logs it, audits it or hands it to a queue, so it never reaches Zoho CRM or Books.

import type { VisitType } from "../../config/visit-types.ts";
import { indiaDate } from "../../lib/india-time.ts";
import { firstNameOf } from "../../lib/names.ts";
import {
  historyProblems,
  type Attachment,
  type Colour,
  type Density,
  type Hairline,
  type NorwoodStage,
  type Remedy,
  type Wave,
} from "../../policy/hair-profile.ts";
import { auditStatementIfWritten, type AuditEntry } from "../ops/audit.ts";
import { serviceOf } from "../booking/services.ts";

export interface FitSpec {
  readonly norwood_stage: NorwoodStage | null;
  readonly head_circumference_cm: number | null;
  readonly front_to_nape_cm: number | null;
  readonly ear_to_ear_cm: number | null;
  readonly temple_to_temple_cm: number | null;
  readonly base_width_in: number | null;
  readonly base_length_in: number | null;
  readonly colour: Colour | null;
  readonly grey_percent: number | null;
  readonly density_percent: Density | null;
  readonly wave: Wave | null;
  readonly hairline: Hairline | null;
  /** The product, by the tier of its first-fit service. */
  readonly product: string | null;
  readonly attachment: Attachment | null;
}

export interface History {
  readonly remedies: Remedy[];
  readonly transplant_year: number | null;
  readonly skin_and_allergies: string | null;
}

export interface HairProfile {
  /** The version's own ID, which a write names as the one it started from. */
  readonly id: string;
  readonly recorded_at: string;
  readonly fit: FitSpec & { readonly product_name: string | null };
  readonly history: History | null;
}

interface HairProfileVersion extends HairProfile {
  readonly recorded_by:
    { readonly kind: "technician"; readonly name: string | null } | { readonly kind: "ops"; readonly staff: string };
  /** The visit it was taken at, its day in India; null for a correction. */
  readonly visit: { readonly id: string; readonly date: string | null; readonly type: VisitType | null } | null;
}

/** What the technician's write came to: the version recorded, or had been, or the fields it was refused for. */
type VisitWrite =
  | {
      readonly kind: "recorded";
      readonly replayed: boolean;
      readonly versionId: string;
      /** It was taken from a version older than the one it has now replaced as the latest. */
      readonly fromOlder: boolean;
    }
  | { readonly kind: "invalid"; readonly fields: string[] };

/** What ops' correction came to: recorded, refused by its fields, or the latest moved on since the form was read. */
type Correction =
  { readonly kind: "recorded" } | { readonly kind: "invalid"; readonly fields: string[] } | { readonly kind: "moved" };

/** The fit spec's columns, in the order the table and the API name them. */
const FIT_COLUMNS = [
  "norwood_stage",
  "head_circumference_cm",
  "front_to_nape_cm",
  "ear_to_ear_cm",
  "temple_to_temple_cm",
  "base_width_in",
  "base_length_in",
  "colour",
  "grey_percent",
  "density_percent",
  "wave",
  "hairline",
  "product",
  "attachment",
] as const satisfies readonly (keyof FitSpec)[];

const HISTORY_COLUMNS = ["remedies", "transplant_year", "skin_and_allergies"] as const;

type VersionRow = FitSpec & {
  id: string;
  created_at: string;
  appointment_id: string | null;
  technician_name: string | null;
  staff: string | null;
  window_start: string | null;
  visit_type: VisitType | null;
  product_name: string | null;
  /** A JSON array of codes. */
  remedies: string | null;
  transplant_year: number | null;
  skin_and_allergies: string | null;
};

const SELECT_VERSIONS = `
  SELECT h.id, h.created_at, h.appointment_id, h.staff, t.name AS technician_name, a.window_start,
    a.type AS visit_type, s.name AS product_name, ${FIT_COLUMNS.map((column) => `h.${column}`).join(", ")},
    ${HISTORY_COLUMNS.map((column) => `h.${column}`).join(", ")}
  FROM hair_profiles h
  LEFT JOIN technicians t ON t.id = h.technician_id
  LEFT JOIN appointments a ON a.id = h.appointment_id
  LEFT JOIN services s ON s.kind = 'first_fit' AND s.tier = h.product
  WHERE h.person_id = ?1
  ORDER BY h.created_at DESC, h.rowid DESC`;

/** Every version of the client's profile, newest first. */
export async function versionsOf(db: D1Database, personId: string): Promise<HairProfileVersion[]> {
  const { results } = await db.prepare(SELECT_VERSIONS).bind(personId).all<VersionRow>();
  return results.map(versionOf);
}

/** The client's profile as it stands: their latest version, or null before one is recorded. */
export async function latestProfile(db: D1Database, personId: string): Promise<HairProfile | null> {
  const row = await db.prepare(`${SELECT_VERSIONS} LIMIT 1`).bind(personId).first<VersionRow>();
  return row === null ? null : profileOf(row);
}

/**
 * The technician's profile step at a visit. It lands whatever the latest is, since the technician measured the client
 * in person; one taken from an older version than the latest says so, for ops to be told. The route answers a replay
 * before it gets here (profileLanded); two sends of one event at once still write one version, which the unique index
 * settles, and the one that lost is answered as a replay.
 */
export async function recordAtVisit(
  db: D1Database,
  input: {
    readonly personId: string;
    readonly appointmentId: string;
    readonly technicianId: string;
    readonly eventId: string;
    readonly fit: FitSpec;
    readonly history: History | null;
    /** The version the phone's form started from; null where the client had none. */
    readonly basedOn: string | null;
    readonly now: Date;
  },
): Promise<VisitWrite> {
  const fields = await problemsOf(db, input.fit, input.history, input.now);
  if (fields.length > 0) return { kind: "invalid", fields };

  const { personId, appointmentId, eventId, technicianId, fit, history, now } = input;
  const latest = await latestIdOf(db, personId);
  const id = crypto.randomUUID();
  const recordedBy = { appointmentId, eventId, technicianId };
  const written = await insertVersion(db, { id, personId, recordedBy, fit, history, now }).run();
  const replayed = written.meta.changes === 0;
  return { kind: "recorded", replayed, versionId: id, fromOlder: !replayed && latest !== input.basedOn };
}

/**
 * Ops' correction, on the client's page: a new version under the member of staff, audited in the same batch by the
 * client's ID and the version's alone. It is written only while the version the form started from is still the
 * latest, which the statement itself checks, so a correction never silently replaces one made since.
 */
export async function correctByOps(
  db: D1Database,
  input: {
    readonly personId: string;
    readonly staff: string;
    readonly fit: FitSpec;
    readonly history: History | null;
    /** The latest version as the form read it; null where the client had none. */
    readonly basedOn: string | null;
    readonly now: Date;
    readonly audit: Omit<AuditEntry, "action" | "subject" | "detail">;
  },
): Promise<Correction> {
  const fields = await problemsOf(db, input.fit, input.history, input.now);
  if (fields.length > 0) return { kind: "invalid", fields };

  const id = crypto.randomUUID();
  const { personId, fit, history, now } = input;
  const entry = {
    ...input.audit,
    action: "hair_profile.correct" as const,
    subject: { kind: "person", id: personId },
    detail: { version: id },
  };
  const [written] = await db.batch([
    insertVersion(db, { id, personId, recordedBy: { staff: input.staff }, fit, history, now }, input.basedOn),
    auditStatementIfWritten(db, entry, now, { table: "hair_profiles", id }),
  ]);
  return (written?.meta.changes ?? 0) > 0 ? { kind: "recorded" } : { kind: "moved" };
}

/** The client's latest version's ID, the person bound to the parameter named. */
const latestIdQuery = (person: string): string =>
  `SELECT id FROM hair_profiles WHERE person_id = ${person} ORDER BY created_at DESC, rowid DESC LIMIT 1`;

/**
 * The hair system the client's profile recommends, by the tier of its first-fit service: the latest version's, as a
 * first fit is offered (src/domain/visits/next-visit.ts) and the client's Home recaps the consultation. Null for none.
 */
export async function recommendedProduct(db: D1Database, personId: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT product FROM hair_profiles WHERE person_id = ?1 ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .bind(personId)
    .first<{ product: string | null }>();
  return row?.product ?? null;
}

/** The ID of the client's latest version; null before one is recorded. */
async function latestIdOf(db: D1Database, personId: string): Promise<string | null> {
  const row = await db.prepare(latestIdQuery("?1")).bind(personId).first<{ id: string }>();
  return row?.id ?? null;
}

/** An erasure's: every version of the person's profile blanked, field by field, the record of who took each kept. */
export function blankProfiles(db: D1Database, personId: string): D1PreparedStatement {
  const blanked = [...FIT_COLUMNS, ...HISTORY_COLUMNS].map((column) => `${column} = NULL`).join(", ");
  return db.prepare(`UPDATE hair_profiles SET ${blanked} WHERE person_id = ?1`).bind(personId);
}

/** Every version, oldest first, as the export a client asks for gives it: the history with it. */
export async function exportedProfiles(db: D1Database, personId: string): Promise<Record<string, unknown>[]> {
  const versions = await versionsOf(db, personId);
  return versions.reverse().map((version) => ({
    recorded_at: version.recorded_at,
    recorded_by: version.recorded_by.kind,
    ...version.fit,
    ...(version.history ?? {}),
  }));
}

/** Whether the phone's event has already landed at the visit, so a replay of it is answered as the first. */
export async function profileLanded(db: D1Database, appointmentId: string, eventId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 FROM hair_profiles WHERE appointment_id = ?1 AND event_id = ?2")
    .bind(appointmentId, eventId)
    .first();
  return row !== null;
}

/** When the visit's first version was recorded, for the card's steps done; null before one was. */
export async function profileTakenAt(db: D1Database, appointmentId: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT MIN(created_at) AS at FROM hair_profiles WHERE appointment_id = ?1")
    .bind(appointmentId)
    .first<{ at: string | null }>();
  return row?.at ?? null;
}

/** The fields that do not hold: a product the services table holds as no first fit's, and a history that clashes. */
async function problemsOf(db: D1Database, fit: FitSpec, history: History | null, now: Date): Promise<string[]> {
  const fields: string[] = [];
  if (fit.product !== null && (await serviceOf(db, "first_fit", fit.product)) === null) fields.push("fit.product");
  if (history !== null) fields.push(...historyProblems(history, now).map((field) => `history.${field}`));
  return fields;
}

type RecordedBy =
  | { readonly appointmentId: string; readonly eventId: string; readonly technicianId: string }
  | { readonly staff: string };

/**
 * A version, written once: a second of the same event at a visit is ignored, for the unique index to settle. Given
 * `whileLatestIs`, it is written only while that is the client's latest version's ID (null: while they have none).
 */
function insertVersion(
  db: D1Database,
  version: {
    readonly id: string;
    readonly personId: string;
    readonly recordedBy: RecordedBy;
    readonly fit: FitSpec;
    readonly history: History | null;
    readonly now: Date;
  },
  whileLatestIs?: string | null,
): D1PreparedStatement {
  const atVisit = "technicianId" in version.recordedBy ? version.recordedBy : null;
  const staff = "staff" in version.recordedBy ? version.recordedBy.staff : null;
  const history = version.history;
  const columns = [
    "id",
    "person_id",
    "appointment_id",
    "event_id",
    "technician_id",
    "staff",
    "created_at",
    ...FIT_COLUMNS,
    ...HISTORY_COLUMNS,
  ];
  const values = [
    version.id,
    version.personId,
    atVisit?.appointmentId ?? null,
    atVisit?.eventId ?? null,
    atVisit?.technicianId ?? null,
    staff,
    version.now.toISOString(),
    ...FIT_COLUMNS.map((column) => version.fit[column]),
    history === null ? null : JSON.stringify(history.remedies),
    history?.transplant_year ?? null,
    history?.skin_and_allergies ?? null,
  ];
  const placeholders = values.map((_, index) => `?${String(index + 1)}`).join(", ");
  if (whileLatestIs === undefined) {
    return db
      .prepare(
        `INSERT INTO hair_profiles (${columns.join(", ")}) VALUES (${placeholders})
         ON CONFLICT (appointment_id, event_id) DO NOTHING`,
      )
      .bind(...values);
  }
  // The person is ?2. IS, unlike =, takes null for null: a client with no version yet.
  const latest = `?${String(values.length + 1)}`;
  return db
    .prepare(
      `INSERT INTO hair_profiles (${columns.join(", ")})
       SELECT ${placeholders} WHERE (${latestIdQuery("?2")}) IS ${latest}`,
    )
    .bind(...values, whileLatestIs);
}

function fitOf(row: VersionRow): HairProfile["fit"] {
  return {
    norwood_stage: row.norwood_stage,
    head_circumference_cm: row.head_circumference_cm,
    front_to_nape_cm: row.front_to_nape_cm,
    ear_to_ear_cm: row.ear_to_ear_cm,
    temple_to_temple_cm: row.temple_to_temple_cm,
    base_width_in: row.base_width_in,
    base_length_in: row.base_length_in,
    colour: row.colour,
    grey_percent: row.grey_percent,
    density_percent: row.density_percent,
    wave: row.wave,
    hairline: row.hairline,
    product: row.product,
    attachment: row.attachment,
    product_name: row.product_name,
  };
}

/** The history a version holds; null where none was recorded, or it was blanked. */
function storedHistory(row: VersionRow): History | null {
  if (row.remedies === null && row.transplant_year === null && row.skin_and_allergies === null) return null;
  return {
    remedies: row.remedies === null ? [] : (JSON.parse(row.remedies) as Remedy[]),
    transplant_year: row.transplant_year,
    skin_and_allergies: row.skin_and_allergies,
  };
}

function profileOf(row: VersionRow): HairProfile {
  return { id: row.id, recorded_at: row.created_at, fit: fitOf(row), history: storedHistory(row) };
}

function versionOf(row: VersionRow): HairProfileVersion {
  return {
    ...profileOf(row),
    recorded_by:
      row.staff === null
        ? { kind: "technician", name: row.technician_name === null ? null : firstNameOf(row.technician_name) }
        : { kind: "ops", staff: row.staff },
    visit:
      row.appointment_id === null
        ? null
        : {
            id: row.appointment_id,
            date: row.window_start === null ? null : indiaDate(new Date(row.window_start)),
            type: row.visit_type,
          },
  };
}
