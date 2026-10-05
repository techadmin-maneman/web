// The consumables ops keep in the console, and what each service is expected to
// use (docs/decisions/0087-consumables-and-stock.md). The owner ruled on 27
// September 2026 that both are set in the console, that the technician app
// reads them with the job, and that a job's use is internal: kept in our
// records, never as a line of the client's invoice.
//
// A consumable is named by a code made from its first name and never changed,
// so a rename, a phone's queued step and the stock ledger all keep to it.
// Retiring one stops the technician app offering it from a day; its rows in
// the ledger stay, and restoring it offers it again.

import { STANDARD_TIER, type VisitType } from "../config/visit-types.ts";
import { auditStatement, type AuditActor } from "./audit.ts";
import { allServices, serviceOf } from "./services.ts";
import { insertRow } from "../lib/sql.ts";

export interface Consumable {
  readonly code: string;
  readonly name: string;
  readonly unit: string;
  /** In paise, for one unit. Ours alone: it reaches no invoice. */
  readonly unitCost: number;
  readonly reorderKit: number | null;
  readonly reorderCentral: number | null;
  /** The day in India it is no longer offered from; null while it is. */
  readonly retiredDate: string | null;
}

interface ConsumableRow {
  code: string;
  name: string;
  unit: string;
  unit_cost: number;
  reorder_kit: number | null;
  reorder_central: number | null;
  retired_date: string | null;
}

const COLUMNS = "code, name, unit, unit_cost, reorder_kit, reorder_central, retired_date";

const consumableOf = (row: ConsumableRow): Consumable => ({
  code: row.code,
  name: row.name,
  unit: row.unit,
  unitCost: row.unit_cost,
  reorderKit: row.reorder_kit,
  reorderCentral: row.reorder_central,
  retiredDate: row.retired_date,
});

/** Every consumable, retired ones too, by name. */
export async function allConsumables(db: D1Database): Promise<Consumable[]> {
  const { results } = await db
    .prepare(`SELECT ${COLUMNS} FROM consumables ORDER BY name COLLATE NOCASE`)
    .all<ConsumableRow>();
  return results.map(consumableOf);
}

async function consumableCoded(db: D1Database, code: string): Promise<Consumable | null> {
  const row = await db.prepare(`SELECT ${COLUMNS} FROM consumables WHERE code = ?1`).bind(code).first<ConsumableRow>();
  return row === null ? null : consumableOf(row);
}

/** Whether the technician app offers it on a day in India: not retired, or retired from a later day. */
export const isOffered = (consumable: Consumable, today: string): boolean =>
  consumable.retiredDate === null || consumable.retiredDate > today;

/** A new consumable's code, from its name: "Tape strips" is tape_strips, a second tape_strips_2. */
function codeFor(name: string, taken: ReadonlySet<string>): string {
  const base =
    name
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 32) || "consumable";
  let code = base;
  for (let next = 2; taken.has(code); next += 1) code = `${base}_${String(next)}`;
  return code;
}

/** What ops write, with who and why, so every change lands with its audit entry. */
interface Written {
  readonly actor: AuditActor;
  readonly requestId: string;
  readonly now: Date;
}

type Saved = { readonly ok: true; readonly consumable: Consumable } | { readonly ok: false; readonly fields: string[] };

/** The other consumable already called this, whatever the case; null when the name is free. */
async function namedAlready(db: D1Database, name: string, except: string | null): Promise<string | null> {
  const row = await db
    .prepare("SELECT code FROM consumables WHERE name = ?1 COLLATE NOCASE AND code IS NOT ?2")
    .bind(name, except)
    .first<{ code: string }>();
  return row?.code ?? null;
}

interface NewConsumable {
  readonly name: string;
  readonly unit: string;
  readonly unitCost: number;
  readonly reorderKit: number | null;
  readonly reorderCentral: number | null;
}

/** Adds one, with its audit entry. A name taken already, retired or not, is refused: restore that one instead. */
export async function addConsumable(db: D1Database, added: NewConsumable, written: Written): Promise<Saved> {
  if ((await namedAlready(db, added.name, null)) !== null) return { ok: false, fields: ["name"] };
  const { results } = await db.prepare("SELECT code FROM consumables").all<{ code: string }>();
  const code = codeFor(added.name, new Set(results.map((row) => row.code)));
  const at = written.now.toISOString();
  await db.batch([
    auditStatement(
      db,
      {
        surface: "ops",
        actor: written.actor,
        action: "consumable.add",
        subject: { kind: "consumable", id: code },
        requestId: written.requestId,
        detail: { unit: added.unit, unit_cost: added.unitCost },
      },
      written.now,
    ),
    insertRow(db, "consumables", {
      code,
      name: added.name,
      unit: added.unit,
      unit_cost: added.unitCost,
      reorder_kit: added.reorderKit,
      reorder_central: added.reorderCentral,
      created_at: at,
      updated_at: at,
    }),
  ]);
  const consumable = await consumableCoded(db, code);
  if (consumable === null) throw new Error("the consumable was not written");
  return { ok: true, consumable };
}

/** A change ops make: only the fields named change. */
interface ConsumableChange {
  readonly name?: string | undefined;
  readonly unit?: string | undefined;
  readonly unitCost?: number | undefined;
  readonly reorderKit?: number | null | undefined;
  readonly reorderCentral?: number | null | undefined;
}

/**
 * Renames it, or changes its unit, its cost or its levels, with the audit
 * entry naming each before and after.
 */
export async function changeConsumable(
  db: D1Database,
  code: string,
  change: ConsumableChange,
  written: Written,
): Promise<Saved | null> {
  const was = await consumableCoded(db, code);
  if (was === null) return null;
  if (change.name !== undefined && (await namedAlready(db, change.name, code)) !== null) {
    return { ok: false, fields: ["name"] };
  }
  const now: Consumable = {
    ...was,
    name: change.name ?? was.name,
    unit: change.unit ?? was.unit,
    unitCost: change.unitCost ?? was.unitCost,
    reorderKit: change.reorderKit === undefined ? was.reorderKit : change.reorderKit,
    reorderCentral: change.reorderCentral === undefined ? was.reorderCentral : change.reorderCentral,
  };
  const detail: Record<string, string | number> = {};
  if (now.name !== was.name) Object.assign(detail, { name_from: was.name, name_to: now.name });
  if (now.unit !== was.unit) Object.assign(detail, { unit_from: was.unit, unit_to: now.unit });
  if (now.unitCost !== was.unitCost)
    Object.assign(detail, { unit_cost_from: was.unitCost, unit_cost_to: now.unitCost });
  // -1 for no level, which no level can be.
  if (now.reorderKit !== was.reorderKit) {
    Object.assign(detail, { reorder_kit_from: was.reorderKit ?? -1, reorder_kit_to: now.reorderKit ?? -1 });
  }
  if (now.reorderCentral !== was.reorderCentral) {
    Object.assign(detail, {
      reorder_central_from: was.reorderCentral ?? -1,
      reorder_central_to: now.reorderCentral ?? -1,
    });
  }
  if (Object.keys(detail).length === 0) return { ok: true, consumable: was };

  await db.batch([
    auditStatement(
      db,
      {
        surface: "ops",
        actor: written.actor,
        action: "consumable.change",
        subject: { kind: "consumable", id: code },
        requestId: written.requestId,
        detail,
      },
      written.now,
    ),
    db
      .prepare(
        `UPDATE consumables SET name = ?2, unit = ?3, unit_cost = ?4, reorder_kit = ?5, reorder_central = ?6,
           updated_at = ?7
         WHERE code = ?1`,
      )
      .bind(code, now.name, now.unit, now.unitCost, now.reorderKit, now.reorderCentral, written.now.toISOString()),
  ]);
  return { ok: true, consumable: now };
}

/**
 * Retires it from a day in India, today or later; or, with null, restores it.
 * Nothing already recorded moves: the ledger keeps its rows, and a job whose
 * phone queued it before it went is still understood.
 */
export async function retireConsumable(
  db: D1Database,
  code: string,
  from: string | null,
  written: Written & { readonly today: string },
): Promise<Saved | null> {
  const was = await consumableCoded(db, code);
  if (was === null) return null;
  if (from !== null && from < written.today) return { ok: false, fields: ["from"] };
  if (from === was.retiredDate) return { ok: true, consumable: was };
  await db.batch([
    auditStatement(
      db,
      {
        surface: "ops",
        actor: written.actor,
        action: from === null ? "consumable.restore" : "consumable.retire",
        subject: { kind: "consumable", id: code },
        requestId: written.requestId,
        detail: from === null ? { retired_from: was.retiredDate ?? "" } : { from },
      },
      written.now,
    ),
    db
      .prepare("UPDATE consumables SET retired_date = ?2, updated_at = ?3 WHERE code = ?1")
      .bind(code, from, written.now.toISOString()),
  ]);
  return { ok: true, consumable: { ...was, retiredDate: from } };
}

/** A service, as the console keeps it: a kind of visit at a tier (docs/decisions/0085-services-ops-can-edit.md). */
interface Service {
  readonly visitType: VisitType;
  readonly tier: string;
}

/** A service whose expected use ops set: with its name, and the day it is retired from, where it is. */
interface UsageService extends Service {
  readonly name: string;
  readonly retiredDate: string | null;
}

/**
 * Every service the console holds, in its order, retired ones too: a visit sold before its service was retired is
 * still done, and its technician's steppers still start at what the service uses. A service's expected use is
 * checked against these rows; consumable_usage has no foreign key to them, since its table came first
 * (migrations 0049 and 0050).
 */
export async function servicesForUse(db: D1Database): Promise<UsageService[]> {
  return (await allServices(db)).map((service) => ({
    visitType: service.kind,
    tier: service.tier,
    name: service.name,
    retiredDate: service.retired_date,
  }));
}

/**
 * The service a job was sold as: its visit's own (appointments.tier), from the hold that booked it; its kind's
 * standard one where the visit names no other (docs/decisions/0085-services-ops-can-edit.md).
 */
export async function serviceOfJob(
  db: D1Database,
  job: { readonly id: string; readonly type: VisitType },
): Promise<Service> {
  const row = await db
    .prepare("SELECT tier FROM appointments WHERE id = ?1")
    .bind(job.id)
    .first<{ tier: string | null }>();
  return { visitType: job.type, tier: row?.tier ?? STANDARD_TIER };
}

/** One consumable a service is expected to use, and how many of its unit. */
interface Expected {
  readonly visitType: VisitType;
  readonly tier: string;
  readonly code: string;
  readonly quantity: number;
}

/** What every service is expected to use. */
export async function expectedUse(db: D1Database): Promise<Expected[]> {
  const { results } = await db
    .prepare(
      `SELECT u.visit_type, u.tier, u.consumable_code, u.quantity FROM consumable_usage u
       JOIN consumables c ON c.code = u.consumable_code
       ORDER BY u.visit_type, u.tier, c.name COLLATE NOCASE`,
    )
    .all<{ visit_type: VisitType; tier: string; consumable_code: string; quantity: number }>();
  return results.map((row) => ({
    visitType: row.visit_type,
    tier: row.tier,
    code: row.consumable_code,
    quantity: row.quantity,
  }));
}

/**
 * Sets what one service is expected to use, the whole list at once, with its
 * audit entry: a consumable left out is expected no more. Refused for a
 * service the console does not hold, a consumable nobody added, or one named
 * twice, each by the field a form can point at. A retired service may still be
 * set: a visit sold before it was retired is still done.
 */
export async function setExpectedUse(
  db: D1Database,
  input: { readonly service: Service; readonly items: readonly { code: string; quantity: number }[] } & Written,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly fields: string[] }> {
  const { service, items } = input;
  if ((await serviceOf(db, service.visitType, service.tier)) === null) return { ok: false, fields: ["tier"] };
  const { results } = await db.prepare("SELECT code FROM consumables").all<{ code: string }>();
  const known = new Set(results.map((row) => row.code));
  const seen = new Set<string>();
  const fields = items.flatMap((item, index) => {
    const wrong = !known.has(item.code) || seen.has(item.code);
    seen.add(item.code);
    return wrong ? [`items.${String(index)}.code`] : [];
  });
  if (fields.length > 0) return { ok: false, fields };

  const at = input.now.toISOString();
  const codes = JSON.stringify(items.map((item) => item.code));
  await db.batch([
    auditStatement(
      db,
      {
        surface: "ops",
        actor: input.actor,
        action: "consumable.usage",
        subject: { kind: "service", id: `${service.visitType}/${service.tier}` },
        requestId: input.requestId,
        detail: Object.fromEntries(items.map((item) => [item.code, item.quantity])),
      },
      input.now,
    ),
    db
      .prepare(
        `DELETE FROM consumable_usage
         WHERE visit_type = ?1 AND tier = ?2 AND consumable_code NOT IN (SELECT value FROM json_each(?3))`,
      )
      .bind(service.visitType, service.tier, codes),
    ...items.map((item) =>
      db
        .prepare(
          `INSERT INTO consumable_usage (visit_type, tier, consumable_code, quantity, set_by, set_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)
           ON CONFLICT (visit_type, tier, consumable_code) DO UPDATE SET
             quantity = excluded.quantity, set_by = excluded.set_by, set_at = excluded.set_at`,
        )
        .bind(service.visitType, service.tier, item.code, item.quantity, input.actor.id, at),
    ),
  ]);
  return { ok: true };
}

/** A consumable as the technician's step offers it: its words, its unit, and what this job's service expects. */
interface Offered {
  readonly code: string;
  readonly name: string;
  readonly unit: string;
  /** How many the service is expected to use; nought for one it lists no use for. */
  readonly expected: number;
}

/**
 * Every consumable the technician may record on a job, those its service
 * expects first, each with the quantity its stepper starts at. Nothing
 * retired by the job's day is offered.
 */
export async function offeredForJob(db: D1Database, service: Service, today: string): Promise<Offered[]> {
  const { results } = await db
    .prepare(
      `SELECT c.code, c.name, c.unit, COALESCE(u.quantity, 0) AS expected FROM consumables c
       LEFT JOIN consumable_usage u ON u.consumable_code = c.code AND u.visit_type = ?1 AND u.tier = ?2
       WHERE c.retired_date IS NULL OR c.retired_date > ?3
       ORDER BY expected = 0, c.name COLLATE NOCASE`,
    )
    .bind(service.visitType, service.tier, today)
    .all<Offered>();
  return results;
}
