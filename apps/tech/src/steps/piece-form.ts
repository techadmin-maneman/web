// The piece step's rules (./Piece.tsx), apart from the screen so they can be read and tested on their own
// (test/node/front-ends/tech-piece-form.test.ts): which of the client's pieces each list offers, which of the kit's hair
// systems match the client's profile, what still keeps Next dim, and the body the step sends.

import type { EventBody, Job } from "../api.ts";
import { oneVisit, steps as copy } from "../content.ts";
import { isLabel } from "./label.ts";
import type { PieceSent } from "./sent-before.ts";

export type ClientPiece = NonNullable<Job["pieces"]>[number];
export type KitHairSystem = Job["kit_hair_systems"][number];

/** The choice against the fit, beside the products' tiers. */
export const DECLINED = "declined";

/** A one visit's choice: a product's tier, DECLINED, or none made yet. */
export type Choice = string | null;

/** What the technician has typed and chosen on the step. */
export interface PieceForm {
  readonly code: string;
  readonly base: string;
  readonly lot: string;
  /** The hair system from the kit, by its stock code; null for a piece from elsewhere. */
  readonly stock: string | null;
  readonly oldCode: string;
  readonly oldReason: string;
  readonly choice: Choice;
}

export const given = (text: string): boolean => text.trim() !== "";

/** A piece still to be fitted, which is the new one on a first fit or a replacement. */
export const toFit = (piece: ClientPiece): boolean =>
  piece.fitted_at === null && piece.failed_at === null && piece.replaced_at === null;
/** A piece on the client's head now, which is the one a replacement takes off. */
export const onTheHead = (piece: ClientPiece): boolean =>
  piece.fitted_at !== null && piece.failed_at === null && piece.replaced_at === null;

/** The product a piece is fitted as: chosen on a one visit, paid for on a first fit, the profile's on a replacement. */
function productFitted(job: Pick<Job, "profile" | "service" | "one_visit" | "type">, choice: Choice): string | null {
  if (job.one_visit) return choice;
  if (job.type === "first_fit") return job.service?.tier ?? null;
  return job.profile?.fit.product ?? null;
}

type Fit = NonNullable<NonNullable<Job["profile"]>["fit"]>;

/** Whether a kit hair system is made to the profile's base, colour, grey and density exactly. */
const madeTo = (each: KitHairSystem, fit: Fit): boolean =>
  each.base_width_in === fit.base_width_in &&
  each.base_length_in === fit.base_length_in &&
  each.colour === fit.colour &&
  each.grey_percent === fit.grey_percent &&
  each.density_percent === fit.density_percent;

/**
 * Whether the kit hair system chosen is not the one this fit is for: another product than the one paid for or chosen,
 * or, with a hair profile, made to another fit. False for none chosen, or a piece from elsewhere.
 */
export function otherThanFitted(
  job: Pick<Job, "kit_hair_systems" | "profile" | "service" | "one_visit" | "type">,
  choice: Choice,
  stock: string | null,
): boolean {
  const hairSystem = job.kit_hair_systems.find((each) => each.code === stock);
  if (hairSystem === undefined) return false;
  const product = productFitted(job, choice);
  const fit = job.profile?.fit ?? null;
  return (product !== null && hairSystem.product !== product) || (fit !== null && !madeTo(hairSystem, fit));
}

/**
 * The kit's hair systems, those made to the client's profile first: the product the client chose on a one visit, paid
 * for on a first fit, or the profile's on a replacement, and the profile's base, colour, grey and density exactly.
 */
export function kitChoices(
  job: Pick<Job, "kit_hair_systems" | "profile" | "service" | "one_visit" | "type">,
  choice: Choice,
): { readonly hairSystem: KitHairSystem; readonly matches: boolean }[] {
  const fit = job.profile?.fit ?? null;
  const product = productFitted(job, choice);
  const matches = (each: KitHairSystem) => fit !== null && each.product === product && madeTo(each, fit);
  const listed = job.kit_hair_systems.map((hairSystem) => ({ hairSystem, matches: matches(hairSystem) }));
  return [...listed.filter((each) => each.matches), ...listed.filter((each) => !each.matches)];
}

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

/** The piece of the kit a label names, with the hair system it is; null for a label no piece in the kit carries. */
function kitPieceOf(
  job: Pick<Job, "kit_hair_systems">,
  label: string,
): { readonly stock: string; readonly lot_code: string | null; readonly expires_on: string | null } | null {
  for (const each of job.kit_hair_systems) {
    const piece = each.units.find((unit) => unit.code === label);
    if (piece !== undefined) return { stock: each.code, lot_code: piece.lot_code, expires_on: piece.expires_on };
  }
  return null;
}

/** Whether a label is of a piece in the kit that expires before the visit's day. */
export function expiredInKit(job: Pick<Job, "kit_hair_systems" | "date">, label: string): boolean {
  const piece = kitPieceOf(job, label);
  return piece !== null && piece.expires_on !== null && piece.expires_on < job.date;
}

/** What the label warns of: a piece of the kit that has expired, or a hair system not the one this fit is for. */
export function labelWarning(
  job: Pick<Job, "kit_hair_systems" | "date" | "profile" | "service" | "one_visit" | "type">,
  form: PieceForm,
): string | null {
  if (expiredInKit(job, form.code)) return copy.piece.expired;
  return otherThanFitted(job, form.choice, form.stock) ? copy.piece.otherThanFitted : null;
}

/**
 * What a new label sets: a kit piece's hair system, and the lot a kit piece fills in, which follows the label. A lot the
 * technician typed stays.
 */
export function afterLabel(
  job: Pick<Job, "kit_hair_systems">,
  was: { readonly code: string; readonly lot: string },
  label: string,
): { readonly stock: string | null; readonly lot: string } {
  const filled = kitPieceOf(job, was.code)?.lot_code ?? null;
  const piece = kitPieceOf(job, label);
  const typed = given(was.lot) && was.lot !== filled;
  return { stock: piece?.stock ?? null, lot: typed ? was.lot : (piece?.lot_code ?? "") };
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
    ...(form.stock === null ? {} : { stock_code: form.stock }),
    ...(given(form.oldCode) ? { old_piece: { piece_code: form.oldCode, failure_reason: form.oldReason.trim() } } : {}),
  };
}
