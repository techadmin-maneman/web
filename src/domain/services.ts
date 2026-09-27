// The services clients book (docs/decisions/0085-services-ops-can-edit.md). Each is a kind of visit and a tier of
// it (src/policy/services.ts): the kind is code, and the services within it are ops', named, timed, ordered and
// retired from a day in the console. The price book prices each by its kind and tier (src/domain/price-book.ts), so
// a service keeps every price it was ever sold at, and a hold copies its service's price, late fee and length as it
// is made (src/domain/scheduling.ts), so nothing already sold moves with a change here.
//
// Every change is written in one batch with its audit entry (ADR 0031): a change that is not recorded does not
// happen. FSM's catalogue follows the services, by each one's own item (src/domain/fsm-catalogue.ts).

import { withGst } from "../config/gst.ts";
import { PRICE_TIER } from "../config/ops-settings.ts";
import { VISIT_BLOCKS } from "../config/scheduling.ts";
import { STANDARD_TIER, VISIT_TYPES, type VisitType } from "../config/visit-types.ts";
import { isOffered, retireRefusal, SERVICE_NAME, tierCodeOf } from "../policy/services.ts";
import { isServiceLength } from "../policy/visit-length.ts";
import { auditStatement, type AuditActor } from "./audit.ts";
import type { Price } from "./price-book.ts";

/** A service, as the services table holds it. */
export interface Service {
  readonly kind: VisitType;
  /** The code the price book prices it under; never changed. */
  readonly tier: string;
  readonly name: string;
  /** How long FSM books it for, and the time the scheduler keeps (src/policy/visit-length.ts). */
  readonly minutes: number;
  /** Its place among its kind's services. */
  readonly sort: number;
  /** India's date from which it is no longer offered; null while it is. */
  readonly retired_date: string | null;
  /** Its item in FSM's catalogue, once found or made. */
  readonly fsm_item_id: string | null;
  readonly updated_by: string;
  readonly updated_at: string;
}

/** A service as a client is offered it: with its price on the day asked about. */
export interface PricedService extends Service {
  readonly price: Price;
}

/** The kinds in their own order, then each kind's services in the order ops gave them. */
const inOrder = (a: Service, b: Service): number =>
  VISIT_TYPES.indexOf(a.kind) - VISIT_TYPES.indexOf(b.kind) || a.sort - b.sort || a.name.localeCompare(b.name);

/** Every service, offered or retired, in the order the console lists them. */
export async function allServices(db: D1Database): Promise<Service[]> {
  const { results } = await db
    .prepare("SELECT kind, tier, name, minutes, sort, retired_date, fsm_item_id, updated_by, updated_at FROM services")
    .all<Service>();
  return results.sort(inOrder);
}

/** One service by its kind and tier; null for none. */
export function serviceOf(db: D1Database, kind: VisitType, tier: string): Promise<Service | null> {
  return db
    .prepare(
      `SELECT kind, tier, name, minutes, sort, retired_date, fsm_item_id, updated_by, updated_at FROM services
       WHERE kind = ?1 AND tier = ?2`,
    )
    .bind(kind, tier)
    .first<Service>();
}

/**
 * The services offered on a day in these kinds, each with its price that day, in the order ops gave them. One with
 * no price that day is left out: nothing is sold at no price at all.
 */
export async function offeredServices(
  db: D1Database,
  on: string,
  kinds: readonly VisitType[] = VISIT_TYPES,
): Promise<PricedService[]> {
  const { results } = await db
    .prepare(
      `SELECT s.kind, s.tier, s.name, s.minutes, s.sort, s.retired_date, s.fsm_item_id, s.updated_by, s.updated_at,
         (SELECT b.amount_ex_gst FROM price_book b WHERE b.item = s.kind AND b.tier = s.tier AND b.valid_from <= ?1
           ORDER BY b.valid_from DESC LIMIT 1) AS amount_ex_gst,
         (SELECT b.gst_percent FROM price_book b WHERE b.item = s.kind AND b.tier = s.tier AND b.valid_from <= ?1
           ORDER BY b.valid_from DESC LIMIT 1) AS gst_percent
       FROM services s`,
    )
    .bind(on)
    .all<Service & { amount_ex_gst: number | null; gst_percent: number | null }>();
  return results
    .filter((row) => kinds.includes(row.kind) && isOffered(row.retired_date, on))
    .flatMap(({ amount_ex_gst: amountExGst, gst_percent: gstPercent, ...service }) =>
      amountExGst === null || gstPercent === null
        ? []
        : [
            {
              ...service,
              price: { amount_ex_gst: amountExGst, amount: withGst(amountExGst, gstPercent), gst_percent: gstPercent },
            },
          ],
    )
    .sort(inOrder);
}

/**
 * The service a booking is for, offered and priced on the day: the one named, or, where a booking names only its
 * kind, the kind's standard service while it is offered, else the first the kind offers. So the site's consultation,
 * a lead's Request and an app from before services, which sends no tier, each book what the kind offers. Null when
 * the kind offers nothing that day, or not the one named.
 */
export async function bookableService(
  db: D1Database,
  kind: VisitType,
  tier: string | undefined,
  on: string,
): Promise<PricedService | null> {
  const offered = await offeredServices(db, on, [kind]);
  if (tier !== undefined) return offered.find((service) => service.tier === tier) ?? null;
  return offered.find((service) => service.tier === STANDARD_TIER) ?? offered[0] ?? null;
}

/** Why a change to a service was refused: the box it names, where there is one. */
export type ServiceRefusal =
  | { readonly refused: "invalid"; readonly field: "name" | "tier" | "minutes" | "retired_date" | "order" }
  /** Another service already has the name, or this kind the code. */
  | { readonly refused: "taken"; readonly field: "name" | "tier" }
  /** Retiring it would leave its kind with nothing to book (src/policy/services.ts). */
  | { readonly refused: "last_of_kind" }
  | { readonly refused: "not_found" };

/** Who made a change, for the audit entry written with it. */
export interface ServiceWrite {
  readonly actor: AuditActor;
  readonly requestId: string;
  readonly now: Date;
}

const subjectOf = (kind: VisitType, tier: string) => ({ kind: "service", id: `${kind}/${tier}` });

/** Another service with this name, whatever its case, other than the one named. */
async function nameTaken(db: D1Database, name: string, except: { kind: VisitType; tier: string } | null) {
  const found = await db
    .prepare("SELECT kind, tier FROM services WHERE name = ?1 COLLATE NOCASE")
    .bind(name)
    .first<{ kind: VisitType; tier: string }>();
  if (found === null) return false;
  return found.kind !== except?.kind || found.tier !== except.tier;
}

/** Whether a write failed on the services table's own keys: the name, or the kind and tier. */
const failedUnique = (error: unknown): boolean =>
  error instanceof Error && error.message.includes("UNIQUE constraint failed: services.");

/**
 * Adds a service to a kind, last in its order. Its code is the one given, or one made from its name; its length the
 * one given, or its kind's. It is offered from the moment it has a price: until then clients do not see it.
 */
export async function addService(
  db: D1Database,
  input: ServiceWrite & {
    readonly kind: VisitType;
    readonly name: string;
    readonly tier?: string | undefined;
    readonly minutes?: number | undefined;
  },
): Promise<Service | ServiceRefusal> {
  const { kind, actor, requestId, now } = input;
  const name = input.name.trim();
  if (!SERVICE_NAME.test(name)) return { refused: "invalid", field: "name" };
  const tier = input.tier ?? tierCodeOf(name);
  if (tier === null || !PRICE_TIER.test(tier)) return { refused: "invalid", field: "tier" };
  const minutes = input.minutes ?? VISIT_BLOCKS[kind].minutes;
  if (!isServiceLength(minutes)) return { refused: "invalid", field: "minutes" };
  if (await nameTaken(db, name, null)) return { refused: "taken", field: "name" };
  if ((await serviceOf(db, kind, tier)) !== null) return { refused: "taken", field: "tier" };

  const at = now.toISOString();
  try {
    await db.batch([
      auditStatement(
        db,
        {
          surface: "ops",
          actor,
          action: "service.add",
          subject: subjectOf(kind, tier),
          requestId,
          detail: { name, minutes },
        },
        now,
      ),
      db
        .prepare(
          `INSERT INTO services (kind, tier, name, minutes, sort, updated_by, updated_at)
           VALUES (?1, ?2, ?3, ?4, (SELECT COALESCE(MAX(sort), -1) + 1 FROM services WHERE kind = ?1), ?5, ?6)`,
        )
        .bind(kind, tier, name, minutes, actor.id, at),
    ]);
  } catch (error) {
    // Another add took the name or the code between the look and the write.
    if (failedUnique(error)) return { refused: "taken", field: "name" };
    throw error;
  }
  return (await serviceOf(db, kind, tier)) ?? { refused: "not_found" };
}

/** A service's new name. Its code stays, so its prices, and what was sold under it, stay its own. */
export async function renameService(
  db: D1Database,
  input: ServiceWrite & { readonly kind: VisitType; readonly tier: string; readonly name: string },
): Promise<Service | ServiceRefusal> {
  const { kind, tier, actor, requestId, now } = input;
  const name = input.name.trim();
  const service = await serviceOf(db, kind, tier);
  if (service === null) return { refused: "not_found" };
  if (!SERVICE_NAME.test(name)) return { refused: "invalid", field: "name" };
  if (await nameTaken(db, name, { kind, tier })) return { refused: "taken", field: "name" };
  if (name === service.name) return service;
  try {
    await db.batch([
      auditStatement(
        db,
        {
          surface: "ops",
          actor,
          action: "service.rename",
          subject: subjectOf(kind, tier),
          requestId,
          detail: { from: service.name, to: name },
        },
        now,
      ),
      db
        .prepare("UPDATE services SET name = ?3, updated_by = ?4, updated_at = ?5 WHERE kind = ?1 AND tier = ?2")
        .bind(kind, tier, name, actor.id, now.toISOString()),
    ]);
  } catch (error) {
    if (failedUnique(error)) return { refused: "taken", field: "name" };
    throw error;
  }
  return (await serviceOf(db, kind, tier)) ?? { refused: "not_found" };
}

/**
 * A service's new length, which visits booked from now on are held and booked for. A hold made before keeps the
 * length it was made with, and a visit already booked keeps at least the time FSM books it for.
 */
export async function setServiceLength(
  db: D1Database,
  input: ServiceWrite & { readonly kind: VisitType; readonly tier: string; readonly minutes: number },
): Promise<Service | ServiceRefusal> {
  const { kind, tier, minutes, actor, requestId, now } = input;
  const service = await serviceOf(db, kind, tier);
  if (service === null) return { refused: "not_found" };
  if (!isServiceLength(minutes)) return { refused: "invalid", field: "minutes" };
  if (minutes === service.minutes) return service;
  await db.batch([
    auditStatement(
      db,
      {
        surface: "ops",
        actor,
        action: "service.length",
        subject: subjectOf(kind, tier),
        requestId,
        detail: { from: service.minutes, to: minutes },
      },
      now,
    ),
    db
      .prepare("UPDATE services SET minutes = ?3, updated_by = ?4, updated_at = ?5 WHERE kind = ?1 AND tier = ?2")
      .bind(kind, tier, minutes, actor.id, now.toISOString()),
  ]);
  return (await serviceOf(db, kind, tier)) ?? { refused: "not_found" };
}

/** A kind's services in a new order: every one of its tiers, each once, first to last. */
export async function reorderServices(
  db: D1Database,
  input: ServiceWrite & { readonly kind: VisitType; readonly tiers: readonly string[] },
): Promise<Service[] | ServiceRefusal> {
  const { kind, tiers, actor, requestId, now } = input;
  const held = (await allServices(db)).filter((service) => service.kind === kind);
  const same =
    [...tiers].sort().join(",") ===
    held
      .map((service) => service.tier)
      .sort()
      .join(",");
  if (!same || new Set(tiers).size !== tiers.length) return { refused: "invalid", field: "order" };
  const at = now.toISOString();
  await db.batch([
    auditStatement(
      db,
      {
        surface: "ops",
        actor,
        action: "service.reorder",
        subject: { kind: "service", id: kind },
        requestId,
        detail: { order: tiers.join(",") },
      },
      now,
    ),
    ...tiers.map((tier, index) =>
      db
        .prepare(
          `UPDATE services SET sort = ?3, updated_by = ?4, updated_at = ?5
           WHERE kind = ?1 AND tier = ?2 AND sort IS NOT ?3`,
        )
        .bind(kind, tier, index, actor.id, at),
    ),
  ]);
  return (await allServices(db)).filter((service) => service.kind === kind);
}

/**
 * Retires a service from a day, today or later: from then clients no longer see it or book it, and a visit already
 * sold stays as it was sold. A kind keeps one service that is never retired and priced by then (src/policy/services.ts).
 * A service already retired is restored first; one whose retirement is still to come may be given another day.
 */
export async function retireService(
  db: D1Database,
  input: ServiceWrite & {
    readonly kind: VisitType;
    readonly tier: string;
    readonly from: string;
    readonly today: string;
  },
): Promise<Service | ServiceRefusal> {
  const { kind, tier, from, today, actor, requestId, now } = input;
  const service = await serviceOf(db, kind, tier);
  if (service === null) return { refused: "not_found" };
  const alreadyRetired = service.retired_date !== null && service.retired_date <= today;
  if (from < today || alreadyRetired) return { refused: "invalid", field: "retired_date" };

  const { results: others } = await db
    .prepare(
      `SELECT s.retired_date,
         EXISTS (SELECT 1 FROM price_book b WHERE b.item = s.kind AND b.tier = s.tier AND b.valid_from <= ?3) AS priced
       FROM services s WHERE s.kind = ?1 AND s.tier != ?2`,
    )
    .bind(kind, tier, from)
    .all<{ retired_date: string | null; priced: number }>();
  const refusal = retireRefusal(
    others.map((other) => ({ retiredDate: other.retired_date, pricedBy: other.priced === 1 })),
  );
  if (refusal !== null) return { refused: refusal };

  await db.batch([
    auditStatement(
      db,
      {
        surface: "ops",
        actor,
        action: "service.retire",
        subject: subjectOf(kind, tier),
        requestId,
        detail: { from },
      },
      now,
    ),
    db
      .prepare("UPDATE services SET retired_date = ?3, updated_by = ?4, updated_at = ?5 WHERE kind = ?1 AND tier = ?2")
      .bind(kind, tier, from, actor.id, now.toISOString()),
  ]);
  return (await serviceOf(db, kind, tier)) ?? { refused: "not_found" };
}

/** Offers a retired service again, or takes back a retirement still to come. Its prices are as they were. */
export async function restoreService(
  db: D1Database,
  input: ServiceWrite & { readonly kind: VisitType; readonly tier: string },
): Promise<Service | ServiceRefusal> {
  const { kind, tier, actor, requestId, now } = input;
  const service = await serviceOf(db, kind, tier);
  if (service === null) return { refused: "not_found" };
  if (service.retired_date === null) return { refused: "invalid", field: "retired_date" };
  await db.batch([
    auditStatement(
      db,
      {
        surface: "ops",
        actor,
        action: "service.restore",
        subject: subjectOf(kind, tier),
        requestId,
        detail: { was: service.retired_date },
      },
      now,
    ),
    db
      .prepare(
        "UPDATE services SET retired_date = NULL, updated_by = ?3, updated_at = ?4 WHERE kind = ?1 AND tier = ?2",
      )
      .bind(kind, tier, actor.id, now.toISOString()),
  ]);
  return (await serviceOf(db, kind, tier)) ?? { refused: "not_found" };
}

/**
 * Keeps the FSM item a service was found to be, by name, or was made as, so it is found by its ID from then on,
 * whatever either is renamed to. Not an ops change, so no audit entry: FSM's catalogue is what it records.
 */
export async function keepFsmItem(db: D1Database, service: Service, fsmItemId: string): Promise<void> {
  if (service.fsm_item_id === fsmItemId) return;
  await db
    .prepare("UPDATE services SET fsm_item_id = ?3 WHERE kind = ?1 AND tier = ?2")
    .bind(service.kind, service.tier, fsmItemId)
    .run();
}
