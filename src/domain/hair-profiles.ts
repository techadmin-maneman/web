// A client's hair profile (docs/decisions/0106-a-clients-hair-profile.md; src/policy/hair-profile.ts): every version
// of the fit spec and the history, the technician's and ops'.
//
// A version is the whole profile as it stood when it was recorded: the phone and the console each start from the
// latest and send it back whole, so the latest version is the profile, and a replacement is ordered to it. None is
// ever changed; an erasure blanks every one (migration 0063 holds the table to that).
//
// The history is health information, recorded with the fit spec as the owner ruled. This file and the export are all
// that read it; nothing here logs it, audits it or hands it to a queue, so it never reaches Zoho CRM, FSM or Books.

import type { VisitType } from "../config/visit-types.ts";
import { indiaDate } from "../lib/india-time.ts";
import { firstNameOf } from "../lib/names.ts";
import {
  historyProblems,
  type Attachment,
  type Colour,
  type Density,
  type Hairline,
  type NorwoodStage,
  type Remedy,
  type Wave,
} from "../policy/hair-profile.ts";
import { auditStatement, type AuditEntry } from "./audit.ts";
import { serviceOf } from "./services.ts";

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
  readonly recorded_at: string;
  readonly fit: FitSpec & { readonly product_name: string | null };
  readonly history: History | null;
}

export interface HairProfileVersion extends HairProfile {
  readonly id: string;
  readonly recorded_by:
    { readonly kind: "technician"; readonly name: string | null } | { readonly kind: "ops"; readonly staff: string };
  /** The visit it was taken at, its day in India; null for a correction. */
  readonly visit: { readonly id: string; readonly date: string | null; readonly type: VisitType | null } | null;
}

/** What a write came to: the version recorded, or had been, or the fields it was refused for. */
export type ProfileWrite =
  { readonly kind: "recorded"; readonly replayed: boolean } | { readonly kind: "invalid"; readonly fields: string[] };

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
 * The technician's profile step at a visit. The route answers a replay before it gets here (profileLanded); two sends
 * of one event at once still write one version, which the unique index settles, and the one that lost is answered as
 * a replay.
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
    readonly now: Date;
  },
): Promise<ProfileWrite> {
  const fields = await problemsOf(db, input.fit, input.history, input.now);
  if (fields.length > 0) return { kind: "invalid", fields };

  const { personId, appointmentId, eventId, technicianId, fit, history, now } = input;
  const recordedBy = { appointmentId, eventId, technicianId };
  const written = await insertVersion(db, { personId, recordedBy, fit, history, now }).run();
  return { kind: "recorded", replayed: written.meta.changes === 0 };
}

/**
 * Ops' correction, on the client's page: a new version under the member of staff, audited in the same batch by the
 * client's ID and the version's alone.
 */
export async function correctByOps(
  db: D1Database,
  input: {
    readonly personId: string;
    readonly staff: string;
    readonly fit: FitSpec;
    readonly history: History | null;
    readonly now: Date;
    readonly audit: Omit<AuditEntry, "action" | "subject" | "detail">;
  },
): Promise<ProfileWrite> {
  const fields = await problemsOf(db, input.fit, input.history, input.now);
  if (fields.length > 0) return { kind: "invalid", fields };

  const id = crypto.randomUUID();
  const { personId, fit, history, now } = input;
  await db.batch([
    insertVersion(db, { id, personId, recordedBy: { staff: input.staff }, fit, history, now }),
    auditStatement(
      db,
      {
        ...input.audit,
        action: "hair_profile.correct",
        subject: { kind: "person", id: personId },
        detail: { version: id },
      },
      now,
    ),
  ]);
  return { kind: "recorded", replayed: false };
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

/** A version, written once: a second of the same event at a visit is ignored, for the unique index to settle. */
function insertVersion(
  db: D1Database,
  version: {
    readonly id?: string;
    readonly personId: string;
    readonly recordedBy: RecordedBy;
    readonly fit: FitSpec;
    readonly history: History | null;
    readonly now: Date;
  },
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
    version.id ?? crypto.randomUUID(),
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
  return db
    .prepare(
      `INSERT INTO hair_profiles (${columns.join(", ")}) VALUES (${placeholders})
       ON CONFLICT (appointment_id, event_id) DO NOTHING`,
    )
    .bind(...values);
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
  return { recorded_at: row.created_at, fit: fitOf(row), history: storedHistory(row) };
}

function versionOf(row: VersionRow): HairProfileVersion {
  return {
    id: row.id,
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
