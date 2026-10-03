// FSM's catalogue against the services and the price book (docs/decisions/0073-prices-from-the-price-book.md,
// docs/decisions/0085-services-ops-can-edit.md). FSM prices a visit's tax invoice from its catalogue item, so an item
// that disagrees with the book raises an invoice for a sum nobody was sold the visit for (INT-03). ADR 0070 holds
// such an invoice as a draft; this keeps the two in line.
//
// Each service has its own service item in FSM: the one whose ID is kept on it, else the one with its name, whose ID
// is then kept, so the two stay together whatever either is renamed to. A booking goes on its service's item, or,
// where FSM has none yet, on its kind's standard item, and ops are told once. A first fit has no standard item: it
// waits for ops until FSM has its hair system's own.
//
// The check reads only, and runs on the cron once an hour: each service offered today, with its price today,
// against its item's name and price. A difference, or an item FSM does not have, is told once, with the item's ID
// and both figures.
//
// The push makes an item FSM does not have and writes the console's name and the book's price over each that
// differs, and only while the owner has FSM_CATALOGUE_PUSH switched on. Staging's FSM is the owner's real org and
// its book holds placeholders (ADR 0025, "The Zoho org"), so the push is off everywhere until the owner switches it
// on in production. A service changed in the console queues it at once; a price, which applies from tomorrow at the
// earliest, is found by the check on its day, which queues it then. It is tried once: the next hour's check is its
// retry, and tells ops if FSM still differs.
//
// The same pass keeps ops' consumables in the catalogue as parts at Rs. 0 (docs/decisions/0087-consumables-and-stock.md).
// It finds each one's part by our name, and remembers it by its ID, so the console can say where each stands. With
// the push off it tells ops of each one missing or named otherwise; with it on it adds the part, or renames it, in
// the pass itself, a few a pass, each a call from the cron run's budget, and tells ops only of one it still could not
// settle an hour on. It never touches a part's price, and a retired consumable's part is left as it is.

import { rupees } from "@maneman/web-kit/money";
import { hasStandardService, STANDARD_TIER, VISIT_TYPE_NAMES, type VisitType } from "../config/visit-types.ts";
import { createCallBudget, type CallBudget } from "../lib/call-budget.ts";
import { indiaDate } from "../lib/india-time.ts";
import { failureReason, type Logger } from "../log.ts";
import { FSM_ITEM_PAGES, FSM_ITEMS_A_PAGE, type FsmItem, type FsmProvider } from "../providers/fsm.ts";
import type { FsmSyncMessage } from "../queues/fsm-sync.ts";
import type { AlertOnce, ResolveAlert } from "./alerts.ts";
import { allConsumables, isOffered, type Consumable } from "./consumables.ts";
import {
  keepFsmItem,
  offeredAmong,
  serviceOf,
  servicesOnDay,
  type PricedService,
  type Service,
  type ServiceOnDay,
} from "./services.ts";

/** Whether two names are one, as FSM's catalogue and the services table compare them: whatever their case. */
const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The FSM service item a service is: the one whose ID is kept on it, else the one with its name, else, for a kind's
 * standard service, the one scripts/setup-fsm.ts made for the kind, named as the kind is.
 */
function itemOf(items: readonly FsmItem[], service: Service): FsmItem | undefined {
  const services = items.filter((item) => item.type === "Service");
  return (
    services.find((item) => item.id === service.fsm_item_id) ??
    services.find((item) => sameName(item.name, service.name)) ??
    (isStandard(service) ? standardItemOf(items, service.kind) : undefined)
  );
}

/** Whether a service is its kind's standard one. A first fit has none, whatever its hair systems are coded. */
const isStandard = (service: { readonly kind: VisitType; readonly tier: string }): boolean =>
  service.tier === STANDARD_TIER && hasStandardService(service.kind);

/** The item scripts/setup-fsm.ts made for a kind's standard service, named as the kind is. */
const standardItemOf = (items: readonly FsmItem[], kind: VisitType): FsmItem | undefined =>
  items.find((item) => item.type === "Service" && sameName(item.name, VISIT_TYPE_NAMES[kind]));

/** FSM's catalogue as a check or a push read it. */
interface Catalogue {
  readonly items: readonly FsmItem[];
  /** Whether it was read to FSM's last page. Where it was not, an item not among `items` may be in FSM all the same. */
  readonly whole: boolean;
  readonly pages: number;
}

/**
 * FSM's catalogue, a page at a time while FSM says there are more, each page a call from `budget`, so a catalogue
 * past a thousand items is read as readily as a dozen. Where the budget ends first, what was read, not whole.
 */
async function readCatalogue(fsm: FsmProvider, budget: CallBudget): Promise<Catalogue> {
  const items: FsmItem[] = [];
  let pages = 0;
  let more = true;
  while (more) {
    if (!budget.spend(1)) return { items, whole: false, pages };
    const read = await fsm.itemsPage(pages + 1);
    items.push(...read.items);
    pages += 1;
    more = read.more;
  }
  return { items, whole: true, pages };
}

/**
 * The services a catalogue read can speak for: every one, once it was read to FSM's last page; else only those whose
 * own item it read. One whose item it did not reach may be in FSM all the same: making it again would give FSM two,
 * and taking another of its name on a page it did read would move the service off its own.
 */
function checkable(services: readonly ServiceOnDay[], catalogue: Catalogue): ServiceOnDay[] {
  if (catalogue.whole) return [...services];
  return services.filter((service) => ownItemRead(catalogue.items, service));
}

/** Whether the items read hold the service's own: the one kept on it, where one is, else one found by its name. */
function ownItemRead(items: readonly FsmItem[], service: Service): boolean {
  if (service.fsm_item_id === null) return itemOf(items, service) !== undefined;
  return items.some((item) => item.id === service.fsm_item_id);
}

/** Whether the part found for a consumable is its own: the one linked to it, where one is, else one of its name. */
const isOwnPart = (consumable: Consumable, part: FsmItem | undefined): boolean =>
  part !== undefined && (consumable.fsmItemId === null || part.id === consumable.fsmItemId);

/** A service offered today whose FSM item does not hold what the console and the book do. */
interface Gap {
  readonly service: PricedService;
  /** FSM's item for it, or null where the catalogue has none by its ID or its name. */
  readonly item: FsmItem | null;
}

/**
 * Each of the services offered today whose FSM item differs from it, in the console's order: no item, another price
 * before GST, or another name. Each item found is kept on its service, so it is found by its ID from then on.
 */
async function gapsBetween(
  db: D1Database,
  items: readonly FsmItem[],
  services: readonly ServiceOnDay[],
  today: string,
): Promise<Gap[]> {
  const gaps: Gap[] = [];
  for (const service of offeredAmong(services, today)) {
    const item = itemOf(items, service);
    if (item !== undefined) await keepFsmItem(db, service, item.id);
    if (item?.price === service.price.amount_ex_gst && item.name === service.name) continue;
    gaps.push({ service, item: item ?? null });
  }
  return gaps;
}

/** What a booking needs to tell ops of an item it could not find, and to log it. */
export interface ItemDeps {
  readonly alertOnce?: AlertOnce | undefined;
  readonly log: Logger;
}

/** The alert a booking raises while its service has no item of its own in FSM; the check closes it once it has. */
const fallbackKey = (kind: VisitType, tier: string) => `fsm_item_fallback:${kind}/${tier}`;

/**
 * The FSM item a booking of this service goes on: the service's own, found by its ID or its name, which is then
 * kept. Where FSM has none, a kind with a standard service books on that one's item, so a booking never fails for an
 * item nobody has made yet: FSM then invoices the visit at that item's price, and the invoice check holds the invoice
 * as a draft where that is not what the client paid (ADR 0070). Ops are told once, and the fallback is logged each
 * time. A first fit goes only on its own hair system's item: with none in FSM it throws, and the booking waits for
 * ops as any FSM refuses (src/domain/held-bookings.ts). Throws too where FSM has no item for the kind at all, which
 * scripts/setup-fsm.ts makes.
 */
export async function itemForService(
  db: D1Database,
  fsm: FsmProvider,
  wanted: { readonly kind: VisitType; readonly tier: string },
  deps: ItemDeps,
): Promise<FsmItem> {
  const items = await fsm.items();
  const service = await serviceOf(db, wanted.kind, wanted.tier);
  const own = service === null ? undefined : itemOf(items, service);
  if (service !== null && own !== undefined) {
    await keepFsmItem(db, service, own.id);
    return own;
  }
  if (!hasStandardService(wanted.kind)) return await noHairSystemItem(wanted, service?.name ?? wanted.tier, deps);

  const standard = await serviceOf(db, wanted.kind, STANDARD_TIER);
  const fallback = (standard === null ? undefined : itemOf(items, standard)) ?? standardItemOf(items, wanted.kind);
  const name = VISIT_TYPE_NAMES[wanted.kind];
  if (fallback === undefined) throw new Error(`FSM has no ${name} item: run scripts/setup-fsm.ts`);
  deps.log.warn("fsm_item_fallback", { kind: wanted.kind, tier: wanted.tier, fsm_item_id: fallback.id });
  await deps.alertOnce?.({
    key: fallbackKey(wanted.kind, wanted.tier),
    message:
      `FSM's catalogue has no item for the service "${service?.name ?? wanted.tier}" (${name}), so its bookings go ` +
      `on item ${fallback.id} ("${fallback.name}"), and FSM invoices them at that item's price. An invoice for ` +
      "another sum than the client paid is held as a draft (ADR 0070). Make the item in FSM, named as the console " +
      "names the service, or let the push make it once it is on (FSM_CATALOGUE_PUSH).",
    link: PRICES_LINK,
  });
  return fallback;
}

/** A first fit whose hair system FSM has no item for: ops are told once what to add, and the booking is refused. */
async function noHairSystemItem(
  wanted: { readonly kind: VisitType; readonly tier: string },
  name: string,
  deps: ItemDeps,
): Promise<never> {
  deps.log.warn("fsm_item_missing", { kind: wanted.kind, tier: wanted.tier });
  await deps.alertOnce?.({
    key: fallbackKey(wanted.kind, wanted.tier),
    message:
      `FSM's catalogue has no item for the hair system "${name}", so its first fits cannot be booked into FSM. Add ` +
      `it in FSM as a service named exactly "${name}", at the console's price. Until then each booking of it is ` +
      "held for you, as one FSM refuses is.",
    link: PRICES_LINK,
  });
  throw new Error(`FSM has no item for the hair system ${wanted.tier}`);
}

export interface CatalogueDeps {
  readonly fsm: FsmProvider;
  /** The fsm-sync queue, which the push runs from. */
  readonly queue: Queue;
  readonly alertOnce: AlertOnce;
  readonly resolveAlert: ResolveAlert;
  /** Where a part the push could not add or rename is logged. */
  readonly log?: Logger;
}

/** What one check found: the services FSM differs on, as kind/tier, and whether it queued the push. */
export interface CatalogueCheck {
  readonly differs: string[];
  readonly queued: boolean;
}

/**
 * The alert a service's difference is told under. A kind's standard service keeps the key its kind was alerted under
 * before services had tiers, so an alert already open stays the one alert.
 */
const alertKey = (service: Service) =>
  service.tier === STANDARD_TIER ? `fsm_catalogue:${service.kind}` : `fsm_catalogue:${service.kind}/${service.tier}`;

/** Where ops set a service's name and price. */
const PRICES_LINK = "/settings/prices";

/**
 * FSM's catalogue list, a page of 200 items at a time while FSM says there are more, each page from the cron run's
 * budget; the cron runs it once an hour. Null when the run has no call left for the first page.
 *
 * Where the budget ends before FSM's last page, the check speaks only for what it read: a service or a consumable
 * whose item was not on those pages is neither told missing nor made, added or unlinked, and ops hear if the next
 * hour cannot read it whole either. It starts from the first page again each hour.
 */
export async function checkCatalogue(
  db: D1Database,
  deps: CatalogueDeps,
  options: { readonly push: boolean; readonly now: Date; readonly budget: CallBudget },
): Promise<CatalogueCheck | null> {
  const { push, now, budget } = options;
  const catalogue = await readCatalogue(deps.fsm, budget);
  if (catalogue.pages === 0) return null;
  await tellIfUnread(deps, catalogue);
  const today = indiaDate(now);
  // Every service, offered or retired, with its price today, read once: the alert of one no longer offered is closed.
  const services = checkable(await servicesOnDay(db, today), catalogue);
  const gaps = await gapsBetween(db, catalogue.items, services, today);
  for (const service of services) {
    const gap = gaps.find((each) => each.service.kind === service.kind && each.service.tier === service.tier);
    // A service FSM has an item for closes the alert its bookings raised while it had none.
    if (gap?.item !== null) await deps.resolveAlert(fallbackKey(service.kind, service.tier));
    if (gap === undefined) {
      // Agreeing, or no longer offered: nothing to tell ops of it.
      await deps.resolveAlert(alertKey(service));
      continue;
    }
    // With the push on, an item missing or differing is told only if it still is an hour after the push was queued.
    await deps.alertOnce({
      key: alertKey(service),
      message: gapMessage(gap, push),
      link: PRICES_LINK,
      after: push ? 2 : 1,
    });
  }

  const queued = push && gaps.length > 0;
  if (queued) await queueCatalogueSync(deps.queue, "fsm_catalogue");
  await checkParts(db, deps, { catalogue, push, now, budget });
  return { differs: gaps.map((gap) => `${gap.service.kind}/${gap.service.tier}`), queued };
}

/** The alert while the hourly check cannot read FSM's whole catalogue from what the cron run has left. */
export const UNREAD_ALERT = "fsm_catalogue:unread";

/** Tells ops once the check has read only part of the catalogue two hours running; closed once one reads it all. */
async function tellIfUnread(deps: CatalogueDeps, catalogue: Catalogue): Promise<void> {
  if (catalogue.whole) {
    await deps.resolveAlert(UNREAD_ALERT);
    return;
  }
  deps.log?.warn("fsm_catalogue_unread", { pages: catalogue.pages });
  const read = `${String(catalogue.pages)} pages of ${String(FSM_ITEMS_A_PAGE)} items`;
  await deps.alertOnce({
    key: UNREAD_ALERT,
    message:
      `FSM's catalogue holds more than the ${read} the hourly check could read from what the cron run had left, ` +
      "so it checked only the items on them: a service or a consumable whose item it did not reach was neither told " +
      "missing nor made or added in FSM. It reads the catalogue from its first page again each hour. If this stays " +
      "open, the catalogue has outgrown what one run can read: raise it with whoever keeps the code.",
    link: PRICES_LINK,
    after: 2,
  });
}

/** The one alert for every consumable FSM does not hold as ours; closed once each is. */
export const PARTS_ALERT = "fsm_catalogue:consumables";

/** Where ops keep the consumables. */
const CONSUMABLES_LINK = "/settings/consumables";

/**
 * How many parts one pass may add or rename in FSM. Each is a call from the
 * cron run's budget, on top of the list; the rest wait for the next hour.
 */
export const PART_WRITES_A_PASS = 5;

/**
 * Each consumable still offered, against FSM's parts: found by the ID it was
 * linked to, else by our name, which links it. A part linked to one consumable
 * is never matched to another by its name: ops may rename a consumable and give
 * its old name to a new one, and the new one would otherwise take the renamed
 * one's part, and the two rename it back and forth every hour. With the push on,
 * one missing is added and one named otherwise renamed, within the pass's
 * allowance. What FSM holds is recorded only where it changed, so an hour with
 * nothing new writes nothing.
 */
async function checkParts(
  db: D1Database,
  deps: CatalogueDeps,
  pass: { readonly catalogue: Catalogue; readonly push: boolean; readonly now: Date; readonly budget: CallBudget },
): Promise<void> {
  const { catalogue, push, now, budget } = pass;
  const consumables = await allConsumables(db);
  const offered = consumables.filter((consumable) => isOffered(consumable, indiaDate(now)));
  const parts = catalogue.items.filter((item) => item.type === "Part");
  /** Each part FSM holds that a consumable, retired or not, is linked to: by whose code. */
  const linked = new Map(
    consumables.flatMap((consumable) =>
      consumable.fsmItemId !== null && parts.some((item) => item.id === consumable.fsmItemId)
        ? [[consumable.fsmItemId, consumable.code] as const]
        : [],
    ),
  );
  /** A part no other consumable is linked to. */
  const free = (item: FsmItem, code: string) => (linked.get(item.id) ?? code) === code;
  let writes = 0;
  /** Takes one write from the pass's allowance and the run's budget, if both have one left. */
  const mayWrite = (): boolean => {
    if (!push || writes >= PART_WRITES_A_PASS || !budget.spend(1)) return false;
    writes += 1;
    return true;
  };

  const unsettled: string[] = [];
  const changed: D1PreparedStatement[] = [];
  for (const consumable of offered) {
    let part =
      parts.find((item) => item.id === consumable.fsmItemId) ??
      parts.find((item) => item.name === consumable.name && free(item, consumable.code));
    // Of a catalogue not read to its end, a part not on the pages read may be in FSM all the same, and one of its
    // name is not its own while the part linked to it was not read.
    if (!catalogue.whole && !isOwnPart(consumable, part)) continue;
    if (part === undefined && mayWrite()) part = await added(deps, consumable);
    else if (part !== undefined && part.name !== consumable.name && mayWrite())
      part = await renamed(deps, consumable, part);
    if (part !== undefined) linked.set(part.id, consumable.code);

    if (part === undefined) unsettled.push(`"${consumable.name}" is not there`);
    else if (part.name !== consumable.name)
      unsettled.push(`part ${part.id} is "${part.name}", ours "${consumable.name}"`);

    const id = part?.id ?? null;
    const name = part?.name ?? null;
    if (id !== consumable.fsmItemId || name !== consumable.fsmName || consumable.fsmCheckedAt === null) {
      changed.push(
        db
          .prepare("UPDATE consumables SET fsm_item_id = ?2, fsm_name = ?3, fsm_checked_at = ?4 WHERE code = ?1")
          .bind(consumable.code, id, name, now.toISOString()),
      );
    }
  }
  if (changed.length > 0) await db.batch(changed);

  if (unsettled.length === 0) {
    await deps.resolveAlert(PARTS_ALERT);
    return;
  }
  const differs = `FSM's catalogue does not hold ${String(unsettled.length)} of the consumables as ours: ${unsettled.join("; ")}.`;
  await deps.alertOnce({
    key: PARTS_ALERT,
    message: push
      ? `${differs} It is still so an hour after the push tried: look for fsm_part_push_failed in the logs, and add or rename each in FSM by hand, as a part at Rs. 0.`
      : `${differs} The push to FSM is off (FSM_CATALOGUE_PUSH): add each in FSM as a part at Rs. 0, or rename it there, exactly as the console names it; the next hourly check finds it by its name.`,
    link: CONSUMABLES_LINK,
    // With the push on, the pass that finds one tries it; ops hear only if the next pass still finds it.
    after: push ? 2 : 1,
  });
}

/** Adds the consumable's part at Rs. 0; undefined if FSM refused, to be tried again next hour. */
async function added(deps: CatalogueDeps, consumable: Consumable): Promise<FsmItem | undefined> {
  try {
    const id = await deps.fsm.createPart(consumable.name);
    deps.log?.info("fsm_part_added", { consumable: consumable.code, item_id: id });
    return { id, name: consumable.name, type: "Part", price: 0 };
  } catch (error) {
    deps.log?.warn("fsm_part_push_failed", { consumable: consumable.code, reason: failureReason(error) });
    return undefined;
  }
}

/** Renames the part to the consumable's name; the part as it was if FSM refused. */
async function renamed(deps: CatalogueDeps, consumable: Consumable, part: FsmItem): Promise<FsmItem> {
  try {
    await deps.fsm.renameItem(part.id, consumable.name);
    deps.log?.info("fsm_part_renamed", { consumable: consumable.code, item_id: part.id });
    return { ...part, name: consumable.name };
  } catch (error) {
    deps.log?.warn("fsm_part_push_failed", { consumable: consumable.code, reason: failureReason(error) });
    return part;
  }
}

/** What ops read: the item's ID, both names and both figures, and what to do. Nothing about any client. */
function gapMessage(gap: Gap, pushed: boolean): string {
  const { service, item } = gap;
  const book = rupees(service.price.amount_ex_gst);
  if (item === null) {
    if (pushed) {
      return (
        `FSM's catalogue still has no service item named "${service.name}" an hour after the push was queued to ` +
        `make it at the price book's ${book}: look for fsm_catalogue_push_failed in the logs, and make it in FSM by hand.`
      );
    }
    const meanwhile = hasStandardService(service.kind)
      ? `that visit is booked on its kind's item and cannot be invoiced at the price book's ${book}`
      : `its first fits are held for you, not booked into FSM, until it has one at the price book's ${book}`;
    return (
      `FSM's catalogue has no service item named "${service.name}", so ${meanwhile}. The push to FSM is off ` +
      "(FSM_CATALOGUE_PUSH): make the item in FSM by hand, named exactly so, or run scripts/setup-fsm.ts " +
      "(docs/runbook.md) for the standard services' own."
    );
  }
  const lines: string[] = [];
  if (item.price !== service.price.amount_ex_gst) {
    const held = item.price === null ? "has no price" : `is ${rupees(item.price)} before GST`;
    lines.push(`FSM's catalogue item ${item.id} ("${item.name}") ${held}, and the price book has ${book}.`);
  }
  if (item.name !== service.name) {
    lines.push(`FSM's catalogue item ${item.id} is named "${item.name}", and the console names it "${service.name}".`);
  }
  if (pushed) {
    lines.push(
      "It still differs an hour after the push was queued: look for fsm_catalogue_push_failed in the logs, and " +
        "set the item in FSM by hand.",
    );
    return lines.join(" ");
  }
  lines.push(
    "FSM prices the visit's tax invoice from its item and Books shows its name, so an invoice that differs is " +
      "held as a draft (ADR 0070). The push to FSM is off (FSM_CATALOGUE_PUSH): set the item in FSM by hand.",
  );
  return lines.join(" ");
}

/** What one push did: how many items it made or wrote over, and each service offered today whose item it did not reach. */
export interface Pushed {
  readonly written: number;
  /** As kind/tier. */
  readonly unreached: readonly string[];
}

/**
 * Makes each missing item and writes the console's name and the book's price over each item that differs today.
 * However often it runs, it writes the same figures, so a repeated or concurrent sync changes nothing, and an item it
 * made is found by its name if its answer never came.
 *
 * It reads the catalogue a page at a time, as many pages as a read of all of it at once may take (FSM_ITEM_PAGES),
 * from the fsm-sync queue's own calls, which the invocation shares with the other messages of its batch. Where that
 * ends before FSM's last page, it writes over each item it found and makes none: an item it did not reach may be
 * there. It answers the services it did not reach, for the queue to log; the hourly check tells ops of one that still
 * differs, to set by hand.
 */
export async function pushCatalogue(db: D1Database, fsm: FsmProvider, today: string): Promise<Pushed> {
  const catalogue = await readCatalogue(fsm, createCallBudget(FSM_ITEM_PAGES));
  const all = await servicesOnDay(db, today);
  const unreached = catalogue.whole
    ? []
    : offeredAmong(all, today).filter((service) => !ownItemRead(catalogue.items, service));
  const gaps = await gapsBetween(db, catalogue.items, checkable(all, catalogue), today);
  let written = 0;
  for (const { service, item } of gaps) {
    const wanted = { name: service.name, price: service.price.amount_ex_gst };
    if (item === null) await keepFsmItem(db, service, await fsm.createItem(wanted));
    else await fsm.updateItem(item.id, wanted);
    written += 1;
  }
  return { written, unreached: unreached.map((service) => `${service.kind}/${service.tier}`) };
}

export async function queueCatalogueSync(queue: Queue, requestId: string): Promise<void> {
  await queue.send({ catalogue_sync: true, request_id: requestId } satisfies FsmSyncMessage);
}
