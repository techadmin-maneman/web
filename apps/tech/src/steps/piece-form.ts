// The piece step's rules (./Piece.tsx), apart from the screen so they can be read and tested on their own
// (test/node/dom/tech-piece-form.test.ts): which of the client's pieces each list offers, what still keeps Next dim,
// and the body the step sends.

import type { EventBody, Job } from "../api.ts";
import { oneVisit, steps as copy } from "../content.ts";
import { isLabel } from "./label.ts";
import type { PieceSent } from "./sent-before.ts";

export type ClientPiece = NonNullable<Job["pieces"]>[number];

/** The choice against the fit, beside the products' tiers. */
export const DECLINED = "declined";

/** A one visit's choice: a product's tier, DECLINED, or none made yet. */
export type Choice = string | null;

/** What the technician has typed and chosen on the step. */
export interface PieceForm {
  readonly code: string;
  readonly base: string;
  readonly lot: string;
  readonly oldCode: string;
  readonly oldReason: string;
  readonly choice: Choice;
}

export const given = (text: string): boolean => text.trim() !== "";

/** A piece still to be fitted, which is the new one on a first fit or a replacement. */
export const toFit = (piece: ClientPiece): boolean => piece.fitted_at === null && piece.failed_at === null;
/** A piece on the client's head now, which is the one a replacement takes off. */
export const onTheHead = (piece: ClientPiece): boolean => piece.fitted_at !== null && piece.failed_at === null;

/** A one visit's choice as the refused step sent it: against the fit, a product, or none. */
export function choiceSent(sent: PieceSent | null): Choice {
  if (sent === null) return null;
  return sent.declined ? DECLINED : sent.product;
}

/** Why the step is open again: the label the API refused, or the step as a whole. */
export function noticeFor(refusedFields: readonly string[]): string {
  const aLabel = refusedFields.some((field) => field === "piece_code" || field === "old_piece");
  return aLabel ? copy.corrected.piece : copy.corrected.other;
}

/** Whether a one visit's client decided against the fit, which fits nothing and asks for no label. */
export const declinedTheFit = (form: PieceForm, job: Pick<Job, "one_visit">): boolean =>
  job.one_visit && form.choice === DECLINED;

/**
 * What still keeps Next dim, in the words it says instead; null once the step can go. `notThisClients`: the label
 * looked up is another client's.
 */
export function stillMissing(form: PieceForm, job: Pick<Job, "one_visit">, notThisClients: boolean): string | null {
  if (job.one_visit && form.choice === null) return oneVisit.chooseFirst;
  if (declinedTheFit(form, job)) return null;
  if (!isLabel(form.code)) return copy.piece.checkFirst;
  if (notThisClients) return copy.piece.notThisClientAction;
  if (!given(form.oldCode)) return null;
  if (!isLabel(form.oldCode)) return copy.piece.checkFirst;
  return given(form.oldReason) ? null : copy.piece.old.needsReason;
}

/** The step's body: against the fit, or the piece with what was said of it, and on a replacement the one off. */
export function pieceBody(form: PieceForm, job: Pick<Job, "one_visit">): EventBody<"piece"> {
  if (declinedTheFit(form, job)) return { declined: true };
  return {
    piece_code: form.code,
    ...(job.one_visit && form.choice !== null ? { product: form.choice } : {}),
    ...(given(form.base) ? { base: form.base.trim() } : {}),
    ...(given(form.lot) ? { supplier_lot: form.lot.trim() } : {}),
    ...(given(form.oldCode) ? { old_piece: { piece_code: form.oldCode, failure_reason: form.oldReason.trim() } } : {}),
  };
}
