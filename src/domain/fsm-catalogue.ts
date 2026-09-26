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

import { rupees } from "@maneman/web-kit/money";
import { FSM_SERVICE_NAMES, VISIT_TYPES, type VisitType } from "../config/visit-types.ts";
import type { CallBudget } from "../lib/call-budget.ts";
import { indiaDate } from "../lib/india-time.ts";
import type { FsmItem, FsmProvider } from "../providers/fsm.ts";
import type { FsmSyncMessage } from "../queues/fsm-sync.ts";
import type { AlertOnce, ResolveAlert } from "./alerts.ts";
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

  const gaps = await gapsBetween(db, await deps.fsm.items(), indiaDate(now));
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
  return { differs: gaps.map((gap) => gap.type), queued };
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
