// The services clients book (docs/decisions/0085-services-ops-can-edit.md). Each is a kind of visit and a tier of
// it (src/policy/services.ts): the kind is code, and the services within it are ops', named, timed, ordered and
// retired from a day in the console. The price book prices each by its kind and tier (src/domain/money/price-book.ts), so
// a service keeps every price it was ever sold at, and a hold copies its service's price, late fee and length as it
// is made (src/domain/booking/hold-slot.ts), so nothing already sold moves with a change here.
//
// Every change is written in one batch with its audit entry (ADR 0031): a change that is not recorded does not
// happen. Books' items follow the services, by each one's own item (src/domain/books/books-items.ts).

import { failedUniqueOn } from "../../lib/d1-errors.ts";
import { withGst } from "../../config/gst.ts";
import { VISIT_BLOCKS } from "../../config/scheduling.ts";
import { hasStandardService, STANDARD_TIER, VISIT_TYPES, type VisitType } from "../../config/visit-types.ts";
import {
  isOffered,
  isServiceDescription,
  retireRefusal,
  SERVICE_NAME,
  tierCodeOf,
  PRICE_TIER,
} from "../../policy/services.ts";
import { isServiceLength } from "../../policy/visit-length.ts";
import { auditStatement, type AuditActor } from "../ops/audit.ts";
import type { Price } from "../money/price-book.ts";

/** A service, as the services table holds it. */
interface Service {
  readonly kind: VisitType;
  /** The code the price book prices it under; never changed. */
  readonly tier: string;
  readonly name: string;
  /** The line clients read under its name as they choose; null until ops write one. */
  readonly description: string | null;
  /** How long it is booked for, and the time the scheduler keeps (src/policy/visit-length.ts). */
  readonly minutes: number;
  /** Its place among its kind's services. */
  readonly sort: number;
  /** India's date from which it is no longer offered; null while it is. */
  readonly retired_date: string | null;
  readonly updated_by: string;
  readonly updated_at: string;
}

/** A service with its price on a day, or null where the book prices it from no day up to then. */
export interface ServiceOnDay extends Service {
  readonly price: Price | null;
}

/** A service as a client is offered it: with its price on the day asked about. */
export interface PricedService extends Service {
  readonly price: Price;
}

/** The kinds in their own order, then each kind's services in the order ops gave them. */
const inOrder = (a: Service, b: Service): number =>
  VISIT_TYPES.indexOf(a.kind) - VISIT_TYPES.indexOf(b.kind) || a.sort - b.sort || a.name.localeCompare(b.name);

const COLUMNS = "kind, tier, name, description, minutes, sort, retired_date, updated_by, updated_at";

/** Every service, offered or retired, in the order the console lists them. */
export async function allServices(db: D1Database): Promise<Service[]> {
  const { results } = await db.prepare(`SELECT ${COLUMNS} FROM services`).all<Service>();
  return results.sort(inOrder);
}

/** One service by its kind and tier; null for none. */
export function serviceOf(db: D1Database, kind: VisitType, tier: string): Promise<Service | null> {
  return db.prepare(`SELECT ${COLUMNS} FROM services WHERE kind = ?1 AND tier = ?2`).bind(kind, tier).first<Service>();
}

/**
 * Every service, offered or retired, each with its price on a day, in the order the console lists them. The price is
 * the book's row in force that day, read with its rate in one lookup a service, since the hourly catalogue check
 * reads this inside the cron run's budget of rows (scripts/lib/free-tier-budget.ts).
 */
export async function servicesOnDay(db: D1Database, on: string): Promise<ServiceOnDay[]> {
  const { results } = await db
    .prepare(
      `SELECT s.kind, s.tier, s.name, s.description, s.minutes, s.sort, s.retired_date, s.updated_by, s.updated_at,
         (SELECT json_array(b.amount_ex_gst, b.gst_percent) FROM price_book b
           WHERE b.item = s.kind AND b.tier = s.tier AND b.valid_from <= ?1
           ORDER BY b.valid_from DESC LIMIT 1) AS price
       FROM services s`,
    )
    .bind(on)
    .all<Service & { price: string | null }>();
  return results
    .map(({ price, ...service }) => {
      if (price === null) return { ...service, price: null };
      const [amountExGst, gstPercent] = JSON.parse(price) as [number, number];
      return {
        ...service,
        price: { amount_ex_gst: amountExGst, amount: withGst(amountExGst, gstPercent), gst_percent: gstPercent },
      };
    })
    .sort(inOrder);
}

/**
 * Those of these services offered on their day in these kinds, in the order ops gave them. One with no price that
 * day is left out: nothing is sold at no price at all.
 */
export function offeredAmong(
  services: readonly ServiceOnDay[],
  on: string,
  kinds: readonly VisitType[] = VISIT_TYPES,
): PricedService[] {
  return services.flatMap(({ price, ...service }) =>
    kinds.includes(service.kind) && isOffered(service.retired_date, on) && price !== null
      ? [{ ...service, price }]
      : [],
  );
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
  return offeredAmong(await servicesOnDay(db, on), on, kinds);
}

/**
 * The service a booking is for, offered and priced on the day: the one named, or, where a booking names only its
 * kind, the kind's standard service while it is offered, else the first the kind offers. So the site's consultation,
 * a lead's Request and an app from before services, which sends no tier, each book what the kind offers. A first fit
 * is booked only as the hair system named. Null when the kind offers nothing that day, or not the one named.
 */
export async function bookableService(
  db: D1Database,
  kind: VisitType,
  tier: string | undefined,
  on: string,
): Promise<PricedService | null> {
  const offered = await offeredServices(db, on, [kind]);
  if (tier !== undefined) return offered.find((service) => service.tier === tier) ?? null;
  if (!hasStandardService(kind)) return null;
  return offered.find((service) => service.tier === STANDARD_TIER) ?? offered[0] ?? null;
}

/** The hair systems a first fit is sold as on a day: the first-fit services offered and priced then, in ops' order. */
export function offeredProducts(db: D1Database, on: string): Promise<PricedService[]> {
  return offeredServices(db, on, ["first_fit"]);
}

/**
 * The service a visit of this kind is offered to a client as (docs/decisions/0086-the-next-visit-is-offered.md): the
 * one their last visit of the kind was, while it is offered and priced on the day, else the kind's first offered in
 * the console's order. A visit that names no service was the standard one. Null where the kind offers
 * nothing that day.
 */
export async function serviceToOffer(
  db: D1Database,
  personId: string,
  kind: VisitType,
  on: string,
): Promise<string | null> {
  const [offered, last] = await Promise.all([
    offeredServices(db, on, [kind]),
    db
      .prepare(
        `SELECT COALESCE(tier, 'standard') AS tier FROM appointments
         WHERE person_id = ?1 AND type = ?2 AND status = 'completed' AND deleted_at IS NULL AND window_start IS NOT NULL
         ORDER BY window_start DESC LIMIT 1`,
      )
      .bind(personId, kind)
      .first<{ tier: string }>(),
  ]);
  return offered.find((service) => service.tier === last?.tier)?.tier ?? offered[0]?.tier ?? null;
}

/** Why a change to a service was refused: the box it names, where there is one. */
export type ServiceRefusal =
  | {
      readonly refused: "invalid";
      readonly field: "name" | "description" | "tier" | "minutes" | "retired_date" | "order";
    }
  /** Another service already has the name, or this kind the code. */
  | { readonly refused: "taken"; readonly field: "name" | "tier" }
  /** Retiring it would leave its kind, one with a standard service, with nothing to book (src/policy/services.ts). */
  | { readonly refused: "last_of_kind" }
  | { readonly refused: "not_found" };

/** Who made a change, for the audit entry written with it. */
interface ServiceWrite {
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
const failedUnique = (error: unknown): boolean => failedUniqueOn(error, "services");

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

/** The line clients read under a service's name. An empty one clears it, so clients read the name alone. */
export async function describeService(
  db: D1Database,
  input: ServiceWrite & { readonly kind: VisitType; readonly tier: string; readonly description: string },
): Promise<Service | ServiceRefusal> {
  const { kind, tier, actor, requestId, now } = input;
  const line = input.description.trim();
  const service = await serviceOf(db, kind, tier);
  if (service === null) return { refused: "not_found" };
  if (!isServiceDescription(line)) return { refused: "invalid", field: "description" };
  const description = line === "" ? null : line;
  if (description === service.description) return service;
  await db.batch([
    auditStatement(
      db,
      {
        surface: "ops",
        actor,
        action: "service.describe",
        subject: subjectOf(kind, tier),
        requestId,
        detail: { from: service.description, to: description },
      },
      now,
    ),
    db
      .prepare("UPDATE services SET description = ?3, updated_by = ?4, updated_at = ?5 WHERE kind = ?1 AND tier = ?2")
      .bind(kind, tier, description, actor.id, now.toISOString()),
  ]);
  return (await serviceOf(db, kind, tier)) ?? { refused: "not_found" };
}

/**
 * A service's new length, which visits booked from now on are held and booked for. A hold made before keeps the
 * length it was made with, and a visit already booked keeps at least its booked window.
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
 * sold stays as it was sold. A kind with a standard service keeps one that is never retired and priced by then, and a
 * first fit may be left with none (src/policy/services.ts).
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
    kind,
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
