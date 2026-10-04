// The Books item each service is invoiced on. The invoice pass bills a visit on
// its service's item, and waits for a service that has none.
//
// Once an hour each service offered today is matched to its item: the one kept on it, else the active one Books holds
// under its name, which is then kept. With the push on, an item Books lacks is made, and one that differs is written
// with the console's name, today's GST-inclusive price and the SAC code, a few a pass; ops hear only of one still
// unsettled an hour on. With the push off, ops are told of each at once. Staging and production share one Books
// organisation, so only the environment BOOKS_ITEM_PUSH names writes.
//
// An invoice carries its own name and price, so an item that differs never changes what a client is billed.

import { rupees } from "@maneman/web-kit/money";
import type { CallBudget } from "../lib/call-budget.ts";
import { indiaDate } from "../lib/india-time.ts";
import { failureReason, type Logger } from "../log.ts";
import { BOOKS_ITEM_PAGES, type BooksItem, type BooksItemDetails, type BooksProvider } from "../providers/books.ts";
import type { AlertOnce, ResolveAlert } from "./alerts.ts";
import { offeredAmong, servicesOnDay, type PricedService, type ServiceOnDay } from "./services.ts";

/** How many items one pass may make or write over. Each is a call from the cron run's budget; the rest wait. */
export const ITEM_WRITES_A_PASS = 5;

/** Where ops set a service's name and price. */
const PRICES_LINK = "/settings/prices";

export interface BooksItemsDeps {
  readonly books: BooksProvider;
  readonly alertOnce: AlertOnce;
  readonly resolveAlert: ResolveAlert;
  readonly log: Logger;
}

export interface BooksItemsOptions {
  readonly push: boolean;
  /** The SAC code every item carries; null until the CA gives one, and then left as Books has it. */
  readonly sac: string | null;
  readonly now: Date;
  readonly budget: CallBudget;
}

/** What one check found: the services whose item still differs, as kind/tier, and how many items it wrote. */
export interface ItemsCheck {
  readonly differs: string[];
  readonly written: number;
}

/** A service offered today, with the item kept on it. */
interface OfferedService extends PricedService {
  readonly booksItemId: string | null;
}

/** A service whose item Books lacks, or holds otherwise than the console and the price book do. */
interface ItemGap {
  readonly service: OfferedService;
  readonly wanted: BooksItemDetails;
  /** Null where Books has no item for it. */
  readonly item: BooksItem | null;
}

const alertKey = (service: { readonly kind: string; readonly tier: string }) =>
  `books_item:${service.kind}/${service.tier}`;

/** Whether two names are one, as Books and the services table compare them: whatever their case. */
const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Each service offered today against Books' items, on the hour, from the cron run's budget. Null when this run is not
 * the one, or has too few calls left to read the list.
 */
export async function checkBooksItems(
  db: D1Database,
  deps: BooksItemsDeps,
  options: BooksItemsOptions,
): Promise<ItemsCheck | null> {
  const { now, budget } = options;
  if (now.getUTCMinutes() >= 5) return null;
  if (!budget.spend(BOOKS_ITEM_PAGES)) return null;

  const items = await deps.books.items();
  const today = indiaDate(now);
  const services = await servicesOnDay(db, today);
  const offered = await withItems(db, offeredAmong(services, today));
  await closeRetired(deps, services, offered);

  const gaps: ItemGap[] = [];
  for (const service of offered) {
    const item = itemFor(items, service, offered);
    if (item !== undefined && item.id !== service.booksItemId) await keepItem(db, service, item.id);
    const wanted = { name: service.name, rate: service.price.amount, sac: options.sac };
    if (item !== undefined && agrees(item, wanted)) {
      await deps.resolveAlert(alertKey(service));
      continue;
    }
    gaps.push({ service, wanted, item: item ?? null });
  }

  let written = 0;
  const differs: string[] = [];
  for (const gap of gaps) {
    const mayWrite = options.push && written < ITEM_WRITES_A_PASS && budget.spend(1);
    if (mayWrite && (await pushItem(db, deps, gap))) {
      written += 1;
      await deps.resolveAlert(alertKey(gap.service));
      continue;
    }
    differs.push(`${gap.service.kind}/${gap.service.tier}`);
    // With the push on, ops hear only of one the next hour's check still finds.
    await deps.alertOnce({
      key: alertKey(gap.service),
      message: gapMessage(gap, options.push),
      link: PRICES_LINK,
      after: options.push ? 2 : 1,
    });
  }
  return { differs, written };
}

/** The services with the Books item kept on each, read in one statement: the table holds a row a service. */
async function withItems(db: D1Database, offered: readonly PricedService[]): Promise<OfferedService[]> {
  const { results } = await db
    .prepare("SELECT kind, tier, books_item_id FROM services")
    .all<{ kind: string; tier: string; books_item_id: string | null }>();
  return offered.map((service) => {
    const row = results.find((each) => each.kind === service.kind && each.tier === service.tier);
    return { ...service, booksItemId: row?.books_item_id ?? null };
  });
}

/** A service no longer offered today has nothing to settle in Books: whatever ops were told of it is over. */
async function closeRetired(
  deps: BooksItemsDeps,
  services: readonly ServiceOnDay[],
  offered: readonly OfferedService[],
): Promise<void> {
  for (const service of services) {
    const isOffered = offered.some((each) => each.kind === service.kind && each.tier === service.tier);
    if (!isOffered) await deps.resolveAlert(alertKey(service));
  }
}

/**
 * The service's item: the one kept on it, else an active one with its name that no other service has kept, so a
 * service renamed to a name another once had never takes that one's item.
 */
function itemFor(
  items: readonly BooksItem[],
  service: OfferedService,
  offered: readonly OfferedService[],
): BooksItem | undefined {
  const kept = items.find((item) => item.id === service.booksItemId);
  if (kept !== undefined) return kept;
  const keptByOthers = new Set(offered.filter((other) => other !== service).map((other) => other.booksItemId));
  return items.find((item) => item.active && sameName(item.name, service.name) && !keptByOthers.has(item.id));
}

function agrees(item: BooksItem, wanted: BooksItemDetails): boolean {
  if (item.name !== wanted.name || item.rate !== wanted.rate) return false;
  return wanted.sac === null || item.sac === wanted.sac;
}

/** Makes the missing item, or writes over the one that differs; false where Books would not, to be tried next hour. */
async function pushItem(db: D1Database, deps: BooksItemsDeps, gap: ItemGap): Promise<boolean> {
  try {
    if (gap.item === null) {
      const itemId = await deps.books.createItem(gap.wanted);
      await keepItem(db, gap.service, itemId);
      deps.log.info("books_item_added", { kind: gap.service.kind, tier: gap.service.tier, item_id: itemId });
    } else {
      await deps.books.updateItem(gap.item.id, gap.wanted);
      deps.log.info("books_item_written", { kind: gap.service.kind, tier: gap.service.tier, item_id: gap.item.id });
    }
    return true;
  } catch (error) {
    const reason = failureReason(error);
    deps.log.warn("books_item_push_failed", { kind: gap.service.kind, tier: gap.service.tier, reason });
    return false;
  }
}

/** Keeps the item a service was found to be, or was made as, so it is found by its ID from then on. */
async function keepItem(db: D1Database, service: OfferedService, itemId: string): Promise<void> {
  await db
    .prepare("UPDATE services SET books_item_id = ?3 WHERE kind = ?1 AND tier = ?2")
    .bind(service.kind, service.tier, itemId)
    .run();
}

/** What ops read: the item's ID, both names and both figures, and what to do. */
function gapMessage(gap: ItemGap, pushOn: boolean): string {
  const { item, wanted } = gap;
  const price = `${rupees(wanted.rate)}, GST included`;
  if (item === null) {
    if (pushOn) {
      return (
        `Books still has no item named "${wanted.name}" an hour after it was asked to make one, so its visits ` +
        `cannot be invoiced. Add it in Books as a service at ${price}, named exactly so.`
      );
    }
    return (
      `Books has no item named "${wanted.name}", so its visits cannot be invoiced. Add it in Books as a service at ` +
      `${price}, named exactly so: the next hourly check finds it by its name.`
    );
  }
  const lines: string[] = [];
  if (item.name !== wanted.name) {
    lines.push(`Books' item ${item.id} is named "${item.name}", and the console names it "${wanted.name}".`);
  }
  if (item.rate !== wanted.rate) {
    lines.push(`Books' item ${item.id} ("${item.name}") is ${rupees(item.rate)}, and the price book has ${price}.`);
  }
  if (wanted.sac !== null && item.sac !== wanted.sac) {
    lines.push(`Books' item ${item.id} ("${item.name}") has no SAC code ${wanted.sac}.`);
  }
  lines.push(
    pushOn
      ? "It still differs an hour after Books was asked to change it: set it in Books by hand."
      : "Set it in Books by hand. An invoice carries its own price, so this changes only what Books offers an invoice raised by hand.",
  );
  return lines.join(" ");
}
