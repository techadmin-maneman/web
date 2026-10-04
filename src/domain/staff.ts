// The Staff list (migrations/0069_staff_and_access.sql): each member of staff by their Access e-mail and their grants,
// the service tokens let in as before, the zones that group cities, and whether the console enforces the list yet.
// Who may do what with them is src/policy/access.ts.

import {
  DEPARTMENTS,
  LEVELS,
  NATIONAL,
  type CallerAccess,
  type Department,
  type Grant,
  type Level,
  type Place,
  type StaffEntry,
  type ZoneOfCity,
} from "../policy/access.ts";
import type { AccessIdentity } from "../providers/cloudflare-access.ts";
import { auditStatement, type AuditActor } from "./audit.ts";
import { isOneOf } from "../lib/one-of.ts";

export interface StaffMember extends StaffEntry {
  readonly email: string;
  readonly addedBy: string;
  readonly addedAt: string;
  readonly changedBy: string | null;
  readonly changedAt: string | null;
}

export interface ServiceToken {
  readonly clientId: string;
  readonly label: string;
  readonly addedBy: string;
  readonly addedAt: string;
}

export interface Zone {
  readonly name: string;
  readonly cities: readonly string[];
}

export interface AccessMode {
  readonly enforced: boolean;
  readonly setBy: string | null;
  readonly setAt: string | null;
}

/** Everything the Staff page shows, before it is narrowed to what its viewer may see. */
export interface StaffBook {
  readonly mode: AccessMode;
  readonly people: readonly StaffMember[];
  readonly serviceTokens: readonly ServiceToken[];
  readonly zones: readonly Zone[];
  /** Every city a grant may name, in the order the console lists cities. */
  readonly cities: readonly string[];
  readonly zoneOf: ZoneOfCity;
}

type GrantRow = { department: string; level: string; geography: string; place: string | null };
type ModeRow = { enforced: number; set_by: string | null; set_at: string | null };
type CityRow = { name: string; zone: string | null };

const isDepartment = (value: string): value is Department => isOneOf(DEPARTMENTS, value);
const isLevel = (value: string): value is Level => isOneOf(LEVELS, value);

function placeOf(geography: string, place: string | null): Place | null {
  if (geography === "national") return NATIONAL;
  if (place === null) return null;
  if (geography === "zone" || geography === "city") return { geography, name: place };
  return null;
}

/** A stored grant; one the policy does not know grants nothing, so it is dropped. */
function grantOf(row: GrantRow): Grant | null {
  const place = placeOf(row.geography, row.place);
  if (place === null || !isDepartment(row.department) || !isLevel(row.level)) return null;
  return { department: row.department, level: row.level, place };
}

const grantsOf = (rows: readonly GrantRow[]): Grant[] =>
  rows.map(grantOf).filter((grant): grant is Grant => grant !== null);

/** "finance:manage:city:Delhi", or "admin:view:national": a grant in the audit log's words. */
export function grantCode(grant: Grant): string {
  const place = grant.place.geography === "national" ? "national" : `${grant.place.geography}:${grant.place.name}`;
  return `${grant.department}:${grant.level}:${place}`;
}

function zoneMap(rows: readonly CityRow[]): ZoneOfCity {
  const zoneOf = new Map<string, string>();
  for (const row of rows) if (row.zone !== null) zoneOf.set(row.name, row.zone);
  return zoneOf;
}

const modeOf = (row: ModeRow | undefined): AccessMode =>
  row === undefined
    ? { enforced: false, setBy: null, setAt: null }
    : { enforced: row.enforced === 1, setBy: row.set_by, setAt: row.set_at };

const MODE = "SELECT enforced, set_by, set_at FROM staff_access_mode WHERE id = 1";
const ZONED_CITIES = "SELECT name, zone FROM cities WHERE zone IS NOT NULL";

/**
 * Who the caller is to the Staff list, with the switch and the zones. Three reads side by side, not a batch: a route's
 * first batch is its own change, which tests that fail the database once it commits count on.
 */
export async function callerAccessOf(db: D1Database, identity: AccessIdentity): Promise<CallerAccess> {
  const listed =
    identity.kind === "staff"
      ? db
          .prepare(
            `SELECT s.active, g.department, g.level, g.geography, g.place
             FROM staff s LEFT JOIN staff_grants g ON g.email = s.email WHERE s.email = ?1`,
          )
          .bind(identity.email)
      : db.prepare("SELECT 1 AS active FROM staff_service_tokens WHERE client_id = ?1").bind(identity.clientId);
  const [mode, cities, rows] = await Promise.all([
    db.prepare(MODE).first<ModeRow>(),
    db.prepare(ZONED_CITIES).all<CityRow>(),
    listed.all<ListedRow>(),
  ]);
  const found = rows.results;
  const enforced = modeOf(mode ?? undefined).enforced;
  const zoneOf = zoneMap(cities.results);
  if (identity.kind === "service") return { enforced, zoneOf, caller: { kind: "service", allowed: found.length > 0 } };
  const active = found[0]?.active === 1;
  return { enforced, zoneOf, caller: { kind: "person", active, grants: grantsOf(heldGrants(found)) } };
}

/** A person's row from the Staff list, with one of their grants, or none where they hold none. */
type ListedRow = {
  active: number;
  department: string | null;
  level: string | null;
  geography: string | null;
  place: string | null;
};

function heldGrants(rows: readonly ListedRow[]): GrantRow[] {
  const grants: GrantRow[] = [];
  for (const row of rows) {
    if (row.department === null || row.level === null || row.geography === null) continue;
    grants.push({ department: row.department, level: row.level, geography: row.geography, place: row.place });
  }
  return grants;
}

type StaffRow = {
  email: string;
  active: number;
  added_by: string;
  added_at: string;
  changed_by: string | null;
  changed_at: string | null;
};
type TokenRow = { client_id: string; label: string; added_by: string; added_at: string };

function zonesOf(rows: readonly { name: string; city: string | null }[]): Zone[] {
  const zones = new Map<string, string[]>();
  for (const row of rows) {
    const cities = zones.get(row.name) ?? [];
    if (row.city !== null) cities.push(row.city);
    zones.set(row.name, cities);
  }
  return [...zones].map(([name, cities]) => ({ name, cities }));
}

export async function readStaffBook(db: D1Database): Promise<StaffBook> {
  const [mode, people, grants, tokens, zones, cities, zoned] = await Promise.all([
    db.prepare(MODE).first<ModeRow>(),
    db
      .prepare("SELECT email, active, added_by, added_at, changed_by, changed_at FROM staff ORDER BY email")
      .all<StaffRow>(),
    db
      .prepare("SELECT email, department, level, geography, place FROM staff_grants ORDER BY id")
      .all<GrantRow & { email: string }>(),
    db
      .prepare("SELECT client_id, label, added_by, added_at FROM staff_service_tokens ORDER BY added_at, client_id")
      .all<TokenRow>(),
    db
      .prepare(
        `SELECT z.name, c.name AS city FROM zones z LEFT JOIN cities c ON c.zone = z.name AND c.active = 1
         ORDER BY z.sort, z.name, c.sort, c.name`,
      )
      .all<{ name: string; city: string | null }>(),
    db.prepare("SELECT name FROM cities WHERE active = 1 ORDER BY sort, name").all<{ name: string }>(),
    db.prepare(ZONED_CITIES).all<CityRow>(),
  ]);
  return {
    mode: modeOf(mode ?? undefined),
    people: people.results.map((row) => ({
      email: row.email,
      active: row.active === 1,
      grants: grantsOf(grants.results.filter((grant) => grant.email === row.email)),
      addedBy: row.added_by,
      addedAt: row.added_at,
      changedBy: row.changed_by,
      changedAt: row.changed_at,
    })),
    serviceTokens: tokens.results.map((row) => ({
      clientId: row.client_id,
      label: row.label,
      addedBy: row.added_by,
      addedAt: row.added_at,
    })),
    zones: zonesOf(zones.results),
    cities: cities.results.map((row) => row.name),
    zoneOf: zoneMap(zoned.results),
  };
}

interface Change {
  readonly actor: AuditActor;
  readonly requestId: string;
  readonly now: Date;
}

const codesOf = (grants: readonly Grant[]): string => grants.map(grantCode).join(";");

/** A member of staff added, or their grants and whether they are let in replaced whole, with its audit entry. */
export async function saveStaffMember(
  db: D1Database,
  input: Change & { readonly email: string; readonly entry: StaffEntry; readonly before: StaffEntry | null },
): Promise<void> {
  const { email, entry, before, actor, requestId, now } = input;
  const at = now.toISOString();
  const grants = entry.grants.map((grant) =>
    db
      .prepare(
        `INSERT INTO staff_grants (email, department, level, geography, place, granted_by, granted_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      )
      .bind(
        email,
        grant.department,
        grant.level,
        grant.place.geography,
        grant.place.geography === "national" ? null : grant.place.name,
        actor.id,
        at,
      ),
  );
  await db.batch([
    db
      .prepare(
        `INSERT INTO staff (email, active, added_by, added_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (email) DO UPDATE SET active = excluded.active, changed_by = ?3, changed_at = ?4`,
      )
      .bind(email, entry.active ? 1 : 0, actor.id, at),
    db.prepare("DELETE FROM staff_grants WHERE email = ?1").bind(email),
    ...grants,
    auditStatement(
      db,
      {
        surface: "ops",
        actor,
        action: "staff.set",
        subject: { kind: "staff", id: email },
        requestId,
        detail: {
          active: entry.active,
          grants: codesOf(entry.grants),
          was_listed: before !== null,
          was_active: before?.active ?? false,
          was_grants: codesOf(before?.grants ?? []),
        },
      },
      now,
    ),
  ]);
}

export async function setEnforced(db: D1Database, input: Change & { readonly enforced: boolean }): Promise<void> {
  const { enforced, actor, requestId, now } = input;
  await db.batch([
    db
      .prepare("UPDATE staff_access_mode SET enforced = ?1, set_by = ?2, set_at = ?3 WHERE id = 1")
      .bind(enforced ? 1 : 0, actor.id, now.toISOString()),
    auditStatement(db, { surface: "ops", actor, action: "staff.enforce", requestId, detail: { enforced } }, now),
  ]);
}

/** A service token let in as every caller was before the list; one already listed takes the new label. */
export async function addServiceToken(
  db: D1Database,
  input: Change & { readonly clientId: string; readonly label: string },
): Promise<void> {
  const { clientId, label, actor, requestId, now } = input;
  await db.batch([
    db
      .prepare(
        `INSERT INTO staff_service_tokens (client_id, label, added_by, added_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (client_id) DO UPDATE SET label = excluded.label`,
      )
      .bind(clientId, label, actor.id, now.toISOString()),
    auditStatement(
      db,
      { surface: "ops", actor, action: "staff.token_add", subject: { kind: "service_token", id: clientId }, requestId },
      now,
    ),
  ]);
}

/** False when no such token is listed. */
export async function removeServiceToken(
  db: D1Database,
  input: Change & { readonly clientId: string },
): Promise<boolean> {
  const { clientId, actor, requestId, now } = input;
  const listed = await db.prepare("SELECT 1 FROM staff_service_tokens WHERE client_id = ?1").bind(clientId).first();
  if (listed === null) return false;
  await db.batch([
    db.prepare("DELETE FROM staff_service_tokens WHERE client_id = ?1").bind(clientId),
    auditStatement(
      db,
      {
        surface: "ops",
        actor,
        action: "staff.token_remove",
        subject: { kind: "service_token", id: clientId },
        requestId,
      },
      now,
    ),
  ]);
  return true;
}
