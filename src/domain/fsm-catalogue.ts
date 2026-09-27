// FSM's catalogue against the services and the price book (docs/decisions/0073-prices-from-the-price-book.md,
// docs/decisions/0085-services-ops-can-edit.md). FSM prices a visit's tax invoice from its catalogue item, so an item
// that disagrees with the book raises an invoice for a sum nobody was sold the visit for (INT-03). ADR 0070 holds
// such an invoice as a draft; this keeps the two in line.
//
// Each service has its own service item in FSM: the one whose ID is kept on it, else the one with its name, whose ID
// is then kept, so the two stay together whatever either is renamed to. A booking goes on its service's item, or,
// where FSM has none yet, on its kind's standard item, and ops are told once.
//
// The check reads only, and runs on the cron once an hour: each service offered today, with its price today,
// against its item's name and price. A difference, or an item FSM does not have, is told once, with the item's ID
// and both figures.
//
// The push makes an item FSM does not have and writes the console's name and the book's price over each that
// differs, and only while the owner has FSM_CATALOGUE_PUSH switched on. Staging's FSM is the owner's real org and
// its book holds placeholders (ADR 0025, "The Zoho org"), so the push is off everywhere until the owner switches it
// on in production. A change in the console that FSM should follow today queues it at once; a price from a later
// day is found by the check on its day, which queues it then. It is tried once: the next hour's check is its retry,
// and tells ops if FSM still differs.

import { rupees } from "@maneman/web-kit/money";
import { FSM_SERVICE_NAMES, STANDARD_TIER, VISIT_TYPES, type VisitType } from "../config/visit-types.ts";
import type { CallBudget } from "../lib/call-budget.ts";
import { indiaDate } from "../lib/india-time.ts";
import type { Logger } from "../log.ts";
import { FSM_ITEM_PAGES, type FsmItem, type FsmProvider } from "../providers/fsm.ts";
import type { FsmSyncMessage } from "../queues/fsm-sync.ts";
import type { AlertOnce, ResolveAlert } from "./alerts.ts";
import type { PriceItem } from "./price-book.ts";
import { allServices, keepFsmItem, offeredServices, serviceOf, type PricedService, type Service } from "./services.ts";

/** Whether two names are one, as FSM's catalogue and the services table compare them: whatever their case. */
const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The FSM service item a service is: the one whose ID is kept on it, else the one with its name, else, for a kind's
 * standard service, the one scripts/setup-fsm.ts made for the kind (FSM_SERVICE_NAMES).
 */
function itemOf(items: readonly FsmItem[], service: Service): FsmItem | undefined {
  const services = items.filter((item) => item.type === "Service");
  return (
    services.find((item) => item.id === service.fsm_item_id) ??
    services.find((item) => sameName(item.name, service.name)) ??
    (service.tier === STANDARD_TIER
      ? services.find((item) => sameName(item.name, FSM_SERVICE_NAMES[service.kind]))
      : undefined)
  );
}

/** A service offered today whose FSM item does not hold what the console and the book do. */
interface Gap {
  readonly service: PricedService;
  /** FSM's item for it, or null where the catalogue has none by its ID or its name. */
  readonly item: FsmItem | null;
}

/**
 * Each service offered today whose FSM item differs from it, in the console's order: no item, another price before
 * GST, or another name. Each item found is kept on its service, so it is found by its ID from then on.
 */
async function gapsBetween(db: D1Database, items: readonly FsmItem[], today: string): Promise<Gap[]> {
  const gaps: Gap[] = [];
  for (const service of await offeredServices(db, today)) {
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
 * kept. Where FSM has none, its kind's standard item, so a booking never fails for an item nobody has made yet:
 * FSM then invoices the visit at that item's price, and the invoice check holds the invoice as a draft where that is
 * not what the client paid (ADR 0070). Ops are told once, and the fallback is logged each time. Throws only where
 * FSM has no item for the kind at all, which scripts/setup-fsm.ts makes.
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

  const standard = await serviceOf(db, wanted.kind, STANDARD_TIER);
  const fallback =
    (standard === null ? undefined : itemOf(items, standard)) ??
    items.find((item) => item.type === "Service" && sameName(item.name, FSM_SERVICE_NAMES[wanted.kind]));
  const name = FSM_SERVICE_NAMES[wanted.kind];
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

export interface CatalogueDeps {
  readonly fsm: FsmProvider;
  /** The fsm-sync queue, which the push runs from. */
  readonly queue: Queue;
  readonly alertOnce: AlertOnce;
  readonly resolveAlert: ResolveAlert;
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
 * FSM's catalogue list, a page of 200 items at a time and at most FSM_ITEM_PAGES of them, from the cron run's budget,
 * once an hour. Null when this run is not the one.
 */
export async function checkCatalogue(
  db: D1Database,
  deps: CatalogueDeps,
  options: { readonly push: boolean; readonly now: Date; readonly budget: CallBudget },
): Promise<CatalogueCheck | null> {
  const { push, now, budget } = options;
  if (now.getUTCMinutes() >= 5) return null;
  if (!budget.spend(FSM_ITEM_PAGES)) return null;

  const gaps = await gapsBetween(db, await deps.fsm.items(), indiaDate(now));
  for (const service of await allServices(db)) {
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
  return { differs: gaps.map((gap) => `${gap.service.kind}/${gap.service.tier}`), queued };
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
    return (
      `FSM's catalogue has no service item named "${service.name}", so that visit is booked on its kind's item and ` +
      `cannot be invoiced at the price book's ${book}. The push to FSM is off (FSM_CATALOGUE_PUSH): make the item in ` +
      "FSM by hand, named exactly so, or run scripts/setup-fsm.ts (docs/runbook.md) for a kind's own four."
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

/**
 * Makes each missing item and writes the console's name and the book's price over each item that differs today;
 * how many it wrote. However often it runs, it writes the same figures, so a repeated or concurrent sync changes
 * nothing, and an item it made is found by its name if its answer never came.
 */
export async function pushCatalogue(db: D1Database, fsm: FsmProvider, today: string): Promise<number> {
  const gaps = await gapsBetween(db, await fsm.items(), today);
  let written = 0;
  for (const { service, item } of gaps) {
    const wanted = { name: service.name, price: service.price.amount_ex_gst };
    if (item === null) await keepFsmItem(db, service, await fsm.createItem(wanted));
    else await fsm.updateItem(item.id, wanted);
    written += 1;
  }
  return written;
}

/** Whether a price ops set changes what FSM's catalogue should hold today: a service's, from today or before. */
export function changesTheCatalogue(price: { readonly item: PriceItem; readonly valid_from: string }, today: string) {
  const isVisit = VISIT_TYPES.some((type) => type === price.item);
  return isVisit && price.valid_from <= today;
}

export async function queueCatalogueSync(queue: Queue, requestId: string): Promise<void> {
  await queue.send({ catalogue_sync: true, request_id: requestId } satisfies FsmSyncMessage);
}
