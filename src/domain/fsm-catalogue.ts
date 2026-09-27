// FSM's catalogue against the price book (docs/decisions/0073-prices-from-the-price-book.md). FSM prices a visit's
// tax invoice from its catalogue item, so an item that disagrees with the book raises an invoice for a sum nobody
// was sold the visit for (INT-03). ADR 0070 holds such an invoice as a draft; this keeps the two in line.
//
// The check reads only, and runs on the cron once an hour: each visit type's service item against the book's
// standard price before GST in force today. A difference is told once, with the item's ID and both figures.
//
// The push writes the book's price over each item that differs, and only while the owner has FSM_CATALOGUE_PUSH
// switched on. Staging's FSM is the owner's real org and its book holds placeholders (ADR 0025, "The Zoho org"),
// so the push is off everywhere until the owner switches it on in production. A price set in the console that is
// in force today queues it at once; a price from a later day is found by the check on its day, which queues it
// then. It is tried once: the next hour's check is its retry, and tells ops if FSM still differs.
//
// The same pass keeps ops' consumables in the catalogue as parts at Rs. 0 (docs/decisions/0087-consumables-and-stock.md).
// It finds each one's part by our name, and remembers it by its ID, so the console can say where each stands. With
// the push off it tells ops of each one missing or named otherwise; with it on it adds the part, or renames it, in
// the pass itself, a few a pass, each a call from the cron run's budget, and tells ops only of one it still could not
// settle an hour on. It never touches a part's price, and a retired consumable's part is left as it is.

import { rupees } from "@maneman/web-kit/money";
import { FSM_SERVICE_NAMES, VISIT_TYPES, type VisitType } from "../config/visit-types.ts";
import type { CallBudget } from "../lib/call-budget.ts";
import { indiaDate } from "../lib/india-time.ts";
import { failureReason, type Logger } from "../log.ts";
import type { FsmItem, FsmProvider } from "../providers/fsm.ts";
import type { FsmSyncMessage } from "../queues/fsm-sync.ts";
import type { AlertOnce, ResolveAlert } from "./alerts.ts";
import { allConsumables, isOffered, type Consumable } from "./consumables.ts";
import { priceOf, type PriceItem } from "./price-book.ts";

/** A visit type whose FSM item does not carry the book's price. */
interface Gap {
  readonly type: VisitType;
  /** FSM's item for it, or null where the catalogue has none by its name. */
  readonly item: FsmItem | null;
  /** The book's standard price before GST, in force today, in paise. */
  readonly book: number;
}

/** Each visit type whose FSM item differs from the book today, in the book's order. */
async function gapsBetween(db: D1Database, items: readonly FsmItem[], today: string): Promise<Gap[]> {
  const gaps: Gap[] = [];
  for (const type of VISIT_TYPES) {
    const price = await priceOf(db, type, today);
    if (price === null) continue;
    const item = items.find((candidate) => candidate.type === "Service" && candidate.name === FSM_SERVICE_NAMES[type]);
    if (item?.price === price.amount_ex_gst) continue;
    gaps.push({ type, item: item ?? null, book: price.amount_ex_gst });
  }
  return gaps;
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

/** What one check found: the visit types FSM differs on, and whether it queued the push. */
export interface CatalogueCheck {
  readonly differs: VisitType[];
  readonly queued: boolean;
}

const alertKey = (type: VisitType) => `fsm_catalogue:${type}`;

/** Where ops set a price. */
const PRICES_LINK = "/settings/prices";

/** One outside call an hour: FSM's catalogue list, from the cron run's budget. Null when this run is not the one. */
export async function checkCatalogue(
  db: D1Database,
  deps: CatalogueDeps,
  options: { readonly push: boolean; readonly now: Date; readonly budget: CallBudget },
): Promise<CatalogueCheck | null> {
  const { push, now, budget } = options;
  if (now.getUTCMinutes() >= 5) return null;
  if (!budget.spend(1)) return null;

  const items = await deps.fsm.items();
  const gaps = await gapsBetween(db, items, indiaDate(now));
  for (const type of VISIT_TYPES) {
    const gap = gaps.find((each) => each.type === type);
    if (gap === undefined) {
      await deps.resolveAlert(alertKey(type));
      continue;
    }
    // With the push on, a price that differs is told only if it still does an hour after the push was queued. An
    // item FSM does not have is not the push's to make, so it is told at once.
    const pushed = push && gap.item !== null;
    await deps.alertOnce({
      key: alertKey(type),
      message: gapMessage(gap, pushed),
      link: PRICES_LINK,
      after: pushed ? 2 : 1,
    });
  }

  const queued = push && gaps.length > 0;
  if (queued) await queueCatalogueSync(deps.queue, "fsm_catalogue");
  await checkParts(db, deps, { items, push, now, budget });
  return { differs: gaps.map((gap) => gap.type), queued };
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
 * linked to, else by our name, which links it. With the push on, one missing
 * is added and one named otherwise renamed, within the pass's allowance. What
 * FSM holds is recorded only where it changed, so an hour with nothing new
 * writes nothing.
 */
async function checkParts(
  db: D1Database,
  deps: CatalogueDeps,
  pass: { readonly items: readonly FsmItem[]; readonly push: boolean; readonly now: Date; readonly budget: CallBudget },
): Promise<void> {
  const { push, now, budget } = pass;
  const offered = (await allConsumables(db)).filter((consumable) => isOffered(consumable, indiaDate(now)));
  const parts = pass.items.filter((item) => item.type === "Part");
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
      parts.find((item) => item.id === consumable.fsmItemId) ?? parts.find((item) => item.name === consumable.name);
    if (part === undefined && mayWrite()) part = await added(deps, consumable);
    else if (part !== undefined && part.name !== consumable.name && mayWrite())
      part = await renamed(deps, consumable, part);

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

/** What ops read: the item's ID and name and both figures, and what to do. Nothing about any client. */
function gapMessage(gap: Gap, pushed: boolean): string {
  const name = FSM_SERVICE_NAMES[gap.type];
  const book = rupees(gap.book);
  if (gap.item === null) {
    return (
      `FSM's catalogue has no service item named "${name}", so that visit cannot be booked or invoiced at the ` +
      `price book's ${book}. Run scripts/setup-fsm.ts (docs/runbook.md), which makes the missing item.`
    );
  }
  const held = gap.item.price === null ? "has no price" : `is ${rupees(gap.item.price)} before GST`;
  const differs = `FSM's catalogue item ${gap.item.id} ("${name}") ${held}, and the price book has ${book}.`;
  if (pushed) {
    return (
      `${differs} It still differs an hour after the push was queued: look for fsm_catalogue_push_failed in the ` +
      "logs, and set the item's price in FSM by hand."
    );
  }
  return (
    `${differs} FSM prices the visit's tax invoice from its item, so that invoice is held as a draft ` +
    "(ADR 0070). The push to FSM is off (FSM_CATALOGUE_PUSH): set the item's price in FSM by hand."
  );
}

/**
 * Writes the book's price over each FSM item that differs today; how many it wrote. However often it runs, it
 * writes the same figures, so a repeated or concurrent sync changes nothing.
 */
export async function pushCatalogue(db: D1Database, fsm: FsmProvider, today: string): Promise<number> {
  const gaps = await gapsBetween(db, await fsm.items(), today);
  let written = 0;
  for (const gap of gaps) {
    if (gap.item === null) continue;
    await fsm.setItemPrice(gap.item.id, gap.book);
    written += 1;
  }
  return written;
}

/** Whether a price ops set changes what FSM's catalogue should hold today: the standard tier, a visit, from today. */
export function changesTheCatalogue(
  price: { readonly item: PriceItem; readonly tier: string; readonly valid_from: string },
  today: string,
): boolean {
  const isVisit = VISIT_TYPES.some((type) => type === price.item);
  return isVisit && price.tier === "standard" && price.valid_from <= today;
}

export async function queueCatalogueSync(queue: Queue, requestId: string): Promise<void> {
  await queue.send({ catalogue_sync: true, request_id: requestId } satisfies FsmSyncMessage);
}
