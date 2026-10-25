// Where we go, and from when (serviceable_pincodes, migration 0021;
// docs/decisions/0061-ops-editable-inputs.md).
//
// `served` decides whether a visit is booked at a pincode at all, on the site
// or in the app; a pincode we do not hold is not served. A client at one we do
// not serve is offered the waitlist instead. `launched_at`
// is the day a technician started coming, and it is a promise: a referral
// invite held for that area lapses twelve months from it, and the waitlist
// alert goes out against it (ADR 0048). So it is dated and `served` is not.
//
// Most rows are loaded from data/pincodes/ncr-pincodes.csv by
// scripts/ops/import-pincodes.ts, which is where a pincode's city and first name
// for its area come from. Ops change the two columns that are theirs, and may
// give the area a better name. They may also add a pincode the file does not
// hold, in one of our cities, which starts unserved; nobody removes one.
//
// Serving a pincode here is a launch, as marking it live on the waitlist is:
// whoever waits there and asked to be told is told, once
// (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).

import { indiaDate, indiaInstant } from "../../lib/india-time.ts";
import { isLaunchInFuture } from "../../policy/launch.ts";
import { namedArea } from "./area-names.ts";
import { auditStatement, type AuditActor, type AuditEntry } from "../platform/audit.ts";
import { isActiveCity } from "../cities/cities.ts";
import { ALERT_WORDS } from "../../config/alert-words.ts";
import type { AlertOnce, ResolveAlert } from "../platform/alerts.ts";
import { cityServedWith } from "../cities/cities.ts";
import {
  launchPreview,
  launchStatements,
  waitingByPincode,
  type LaunchAlert,
  type LaunchedPincode,
} from "../booking/waitlist.ts";

/** A pincode we hold, and whether a technician works there. */
export interface Pincode {
  readonly pincode: string;
  /** Null until ops have named the area. */
  readonly area: string | null;
  readonly city: string;
  readonly served: number;
  /** When a technician started or starts coming; null where nobody has said. */
  readonly launched_at: string | null;
  /** India's date a paused pincode takes new clients again; null when it is not paused. */
  readonly paused_until: string | null;
}

/** The pincode as we hold it; null for one we do not. */
export function pincodeOf(db: D1Database, pin: string): Promise<Pincode | null> {
  return db
    .prepare(
      `SELECT pincode, ${namedArea("p")} AS area, city, served, launched_at, paused_until FROM serviceable_pincodes p
       WHERE pincode = ?1`,
    )
    .bind(pin)
    .first<Pincode>();
}

/**
 * Whether a pincode takes a new client on this India date: served, and not paused. A client we already come to books
 * there regardless; a pause holds back only new consultations (docs/decisions/0221-launches-scheduled-paused-and-checked.md).
 */
export const takesNewClientsOn = (pincode: Pincode | null, today: string): boolean =>
  pincode?.served === 1 && (pincode.paused_until === null || pincode.paused_until <= today);

/** Whether a pincode takes a new client today. */
export async function takesNewClients(db: D1Database, pin: string, now: Date): Promise<boolean> {
  return takesNewClientsOn(await pincodeOf(db, pin), indiaDate(now));
}

/** Whether a technician comes to this pincode. */
export async function isServed(db: D1Database, pin: string): Promise<boolean> {
  return (await pincodeOf(db, pin))?.served === 1;
}

/** A launch date as India's date. Stored as midnight in India, which is the evening before in UTC. */
const launchDateOf = (launchedAt: string | null): string | null =>
  launchedAt === null ? null : indiaDate(new Date(launchedAt));

/** A pincode we hold, as a launch reads it. */
export const launchedPincode = (held: Pincode): LaunchedPincode => ({
  pincode: held.pincode,
  served: held.served === 1,
  launchOn: launchDateOf(held.launched_at),
});

export interface AreaPincode {
  readonly pincode: string;
  readonly area: string;
  readonly city: string;
  readonly served: boolean;
  /** India's date it started or starts, or null where nobody has said. */
  readonly launch_on: string | null;
  /** How many are on its waitlist, and how many serving it would tell now. */
  readonly waiting: number;
  readonly to_alert: number;
  /** India's date a paused pincode takes new clients again; null when it is not paused. */
  readonly paused_until: string | null;
}

/** One pincode's two columns, as ops send them, and a new name for its area if they gave one. */
interface AreaChange {
  readonly pincode: string;
  readonly served: boolean;
  readonly launch_on: string | null;
  readonly area?: string | undefined;
}

type Row = {
  pincode: string;
  area: string;
  city: string;
  served: number;
  launched_at: string | null;
  paused_until: string | null;
};

/** Every pincode we hold, by city and then by pincode, as the console lists them. */
export async function serviceArea(db: D1Database): Promise<AreaPincode[]> {
  const { results } = await db
    .prepare(
      "SELECT pincode, area, city, served, launched_at, paused_until FROM serviceable_pincodes ORDER BY city, pincode",
    )
    .all<Row>();
  const waiting = await waitingByPincode(db);
  return results.map((row) => ({
    pincode: row.pincode,
    area: row.area,
    city: row.city,
    served: row.served === 1,
    launch_on: launchDateOf(row.launched_at),
    waiting: waiting.get(row.pincode)?.waiting ?? 0,
    to_alert: waiting.get(row.pincode)?.toAlert ?? 0,
    paused_until: row.paused_until,
  }));
}

/** Why a change cannot be made. */
type AreaRefusal =
  | { readonly kind: "unknown"; readonly pincodes: readonly string[] }
  | { readonly kind: "launch_in_future"; readonly pincodes: readonly string[] }
  | { readonly kind: "no_technician"; readonly pincodes: readonly string[] }
  | { readonly kind: "empty_area" };

/**
 * The pincodes among these in a city no active technician works in. Served there, a pincode would tell its waitlist
 * and the site that we come, and offer nothing to book (docs/decisions/0117-a-technician-takes-visits-in-their-own-city.md).
 */
export async function pincodesWithNoTechnician(db: D1Database, pincodes: readonly string[]): Promise<string[]> {
  if (pincodes.length === 0) return [];
  const { results } = await db
    .prepare(
      `SELECT p.pincode FROM serviceable_pincodes p
       WHERE p.pincode IN (SELECT value FROM json_each(?1))
         AND NOT EXISTS (SELECT 1 FROM technicians t WHERE t.active = 1 AND t.city = p.city)`,
    )
    .bind(JSON.stringify(pincodes))
    .all<{ pincode: string }>();
  return results.map((row) => row.pincode);
}

interface AreaResult {
  /** The pincodes this actually altered: served, launch date or name. */
  readonly changed: readonly AreaChange[];
  readonly served: number;
  /** The launch alerts queued for the pincodes it began serving. */
  readonly alerts: readonly LaunchAlert[];
}

const servingChanged = (was: AreaPincode, change: AreaChange) =>
  was.served !== change.served || was.launch_on !== change.launch_on;

const renamed = (was: AreaPincode, change: AreaChange) => change.area !== undefined && change.area !== was.area;

/** A change that would serve a pincode from a day still to come, which /book would take bookings for at once. */
function servesLater(was: AreaPincode, change: AreaChange, today: string): boolean {
  if (!change.served || change.launch_on === null || !servingChanged(was, change)) return false;
  return isLaunchInFuture(change.launch_on, today);
}

/** Why a change of the service area is refused before anything is written; null where it may go ahead. */
async function refusalOf(
  db: D1Database,
  input: { changes: readonly AreaChange[]; held: ReadonlyMap<string, AreaPincode>; today: string },
): Promise<AreaRefusal | null> {
  const { changes, held, today } = input;
  const unknown = changes.filter((change) => !held.has(change.pincode)).map((change) => change.pincode);
  if (unknown.length > 0) return { kind: "unknown", pincodes: unknown };

  const later = changes.filter((change) => {
    const was = held.get(change.pincode);
    return was !== undefined && servesLater(was, change, today);
  });
  if (later.length > 0) return { kind: "launch_in_future", pincodes: later.map((change) => change.pincode) };

  const launching = changes.filter((change) => change.served && held.get(change.pincode)?.served === false);
  const unstaffed = await pincodesWithNoTechnician(
    db,
    launching.map((change) => change.pincode),
  );
  return unstaffed.length > 0 ? { kind: "no_technician", pincodes: unstaffed } : null;
}

/**
 * Sets `served` and `launch_on` on the pincodes named, and the area's name
 * where ops gave one, and nothing else. Every pincode altered gets its own
 * audit entry naming what it was and what it is, and the whole change goes in
 * one batch with them: a change that is not recorded does not happen (ADR 0031).
 *
 * A pincode it begins serving is launched in the same batch, as the waitlist's
 * launch does, from the date the row gives or today: the alerts are queued and
 * counted in a launch's own audit entry, so nobody who asked to be told is left
 * waiting by the screen ops used.
 *
 * Three refusals: a pincode we do not hold; one served from a day still to come;
 * and a change that would leave no served pincode at all, which would put every
 * client on the waitlist.
 */
export async function setServiceArea(
  db: D1Database,
  input: {
    readonly changes: readonly AreaChange[];
    readonly actor: AuditActor;
    readonly requestId: string;
    readonly now: Date;
  },
): Promise<AreaResult | AreaRefusal> {
  const { changes, actor, requestId, now } = input;
  const today = indiaDate(now);
  const held = new Map((await serviceArea(db)).map((pincode) => [pincode.pincode, pincode]));

  const refused = await refusalOf(db, { changes, held, today });
  if (refused !== null) return refused;

  const after = new Map(held);
  for (const change of changes) {
    const was = held.get(change.pincode);
    if (was !== undefined) after.set(change.pincode, { ...was, served: change.served, launch_on: change.launch_on });
  }
  const served = [...after.values()].filter((pincode) => pincode.served).length;
  if (served === 0) return { kind: "empty_area" };

  const statements: D1PreparedStatement[] = [];
  const changed: AreaChange[] = [];
  const alerts: LaunchAlert[] = [];
  const entry = (action: "pincode.set" | "pincode.rename" | "pincode.launch", pincode: string) => ({
    surface: "ops" as const,
    actor,
    action,
    subject: { kind: "pincode", id: pincode },
    requestId,
  });

  for (const change of changes) {
    const was = held.get(change.pincode);
    if (was === undefined || (!servingChanged(was, change) && !renamed(was, change))) continue;
    changed.push(change);

    if (!was.served && change.served) {
      const launch = await launchStatements(db, {
        pincode: { pincode: was.pincode, served: was.served, launchOn: was.launch_on },
        launchDay: change.launch_on ?? today,
        audit: entry("pincode.launch", change.pincode),
        now,
        pacedAfter: alerts.length,
      });
      alerts.push(...launch.alerts);
      statements.push(
        setAudit({ db, entry: entry("pincode.set", change.pincode), was, change, launchOn: launch.launchOn, now }),
      );
      statements.push(...launch.statements, cityServedWith(db, change.pincode));
    } else if (servingChanged(was, change)) {
      statements.push(
        setAudit({ db, entry: entry("pincode.set", change.pincode), was, change, launchOn: change.launch_on, now }),
        db.prepare("UPDATE serviceable_pincodes SET served = ?2, launched_at = ?3 WHERE pincode = ?1").bind(
          change.pincode,
          change.served ? 1 : 0,
          // Midnight in India on the day, as every other time in the database is an instant.
          change.launch_on === null ? null : indiaInstant(change.launch_on, "00:00").toISOString(),
        ),
      );
    }

    if (change.area !== undefined && renamed(was, change)) {
      statements.push(
        auditStatement(
          db,
          { ...entry("pincode.rename", change.pincode), detail: { from: was.area, to: change.area } },
          now,
        ),
        db
          .prepare("UPDATE serviceable_pincodes SET area = ?2, area_named_by = ?3 WHERE pincode = ?1")
          .bind(change.pincode, change.area, actor.id),
      );
    }
  }

  if (statements.length > 0) await db.batch(statements);
  return { changed, served, alerts };
}

/** The audit entry of a pincode's served and launch date set: what they were, and what they are now. */
function setAudit({
  db,
  entry,
  was,
  change,
  launchOn,
  now,
}: {
  db: D1Database;
  entry: AuditEntry;
  was: AreaPincode;
  change: AreaChange;
  launchOn: string | null;
  now: Date;
}): D1PreparedStatement {
  const detail = {
    served_from: was.served,
    served_to: change.served,
    launch_from: was.launch_on ?? "",
    launch_to: launchOn ?? "",
  };
  return auditStatement(db, { ...entry, detail }, now);
}

/** A pincode ops add: its number, what messages call its area, and the city it is in. */
interface NewPincode {
  readonly pincode: string;
  readonly area: string;
  readonly city: string;
}

/** Why a pincode cannot be added: we hold it already, or its city is not one of ours. */
type AddRefusal = "held" | "unknown_city";

/**
 * Adds a pincode the reference file does not hold, unserved, with the name ops gave its area, in one batch with its
 * audit entry. Launching it is a step of its own, which says first who it would tell.
 */
export async function addPincode(
  db: D1Database,
  input: { readonly pincode: NewPincode; readonly actor: AuditActor; readonly requestId: string; readonly now: Date },
): Promise<AreaPincode | AddRefusal> {
  const { pincode, actor, requestId, now } = input;
  if ((await pincodeOf(db, pincode.pincode)) !== null) return "held";
  if (!(await isActiveCity(db, pincode.city))) return "unknown_city";

  await db.batch([
    db
      .prepare(
        `INSERT INTO serviceable_pincodes (pincode, area, city, served, launched_at, area_named_by)
         VALUES (?1, ?2, ?3, 0, NULL, ?4)`,
      )
      .bind(pincode.pincode, pincode.area, pincode.city, actor.id),
    auditStatement(
      db,
      {
        surface: "ops",
        actor,
        action: "pincode.add",
        subject: { kind: "pincode", id: pincode.pincode },
        requestId,
        detail: { city: pincode.city },
      },
      now,
    ),
  ]);
  const waiting = await launchPreview(db, pincode.pincode);
  return {
    ...pincode,
    served: false,
    launch_on: null,
    waiting: waiting.waiting,
    to_alert: waiting.alerts,
    paused_until: null,
  };
}

const UNCOVERED = "city_uncovered:";

/**
 * Each city with a pincode served and no active technician, told once until a technician works there again or it
 * is served no more: a technician switched off can leave a city live with nobody, and the site then shows every day
 * full. Asked at a switch-off or back on, and each morning for whatever else changed.
 */
export async function tellOfUncoveredCities(
  db: D1Database,
  deps: { readonly alertOnce: AlertOnce; readonly resolveAlert: ResolveAlert },
): Promise<void> {
  const { results } = await db
    .prepare(
      `SELECT p.city, COUNT(*) AS pincodes FROM serviceable_pincodes p
       WHERE p.served = 1 AND p.city NOT IN (SELECT city FROM technicians WHERE active = 1 AND city IS NOT NULL)
       GROUP BY p.city`,
    )
    .all<{ city: string; pincodes: number }>();
  for (const uncovered of results) {
    await deps.alertOnce({
      key: `${UNCOVERED}${uncovered.city}`,
      message: ALERT_WORDS.city_uncovered(uncovered),
      link: "/technicians",
    });
  }
  const still = new Set(results.map((row) => `${UNCOVERED}${row.city}`));
  const { results: open } = await db
    .prepare("SELECT key FROM alerts WHERE resolved_at IS NULL AND key >= ?1 AND key < ?2")
    .bind(UNCOVERED, `${UNCOVERED.slice(0, -1)};`)
    .all<{ key: string }>();
  for (const { key } of open) if (!still.has(key)) await deps.resolveAlert(key);
}
