// The piece step's rules (./Piece.tsx), apart from the screen so they can be read and tested on their own
// (test/node/front-ends/tech-piece-form.test.ts): which of the client's pieces each list offers, which of the kit's hair
// systems match the client's profile, what still keeps Next dim, and the body the step sends.

import type { EventBody, Job } from "../api.ts";
import { oneVisit, steps as copy } from "../content.ts";
import type { Queued } from "../store/outbox.ts";
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
  /** On a replacement, the piece on the client's head, from the card; empty for none. */
  readonly oldCode: string;
  readonly choice: Choice;
  /** On a one visit, a product chosen with its fit booked for another day (docs/decisions/0247-the-steps-left.md). */
  readonly later: boolean;
}

export const given = (text: string): boolean => text.trim() !== "";

/** A piece on the client's head now, which is the one a replacement takes off. */
const onTheHead = (piece: ClientPiece): boolean =>
  piece.fitted_at !== null && piece.failed_at === null && piece.replaced_at === null;

/**
 * On a replacement, the piece that comes off: the newest on the client's head fitted before this visit's day, so a step
 * opened again after its piece landed never names the new one. Null for any other visit, or none on the head.
 */
export function cameOff(job: Pick<Job, "type" | "pieces" | "date">): ClientPiece | null {
  if (job.type !== "replacement") return null;
  return (job.pieces ?? []).find((piece) => onTheHead(piece) && (piece.fitted_at ?? "") < job.date) ?? null;
}

/** The product a piece is fitted as: chosen on a one visit, paid for on a first fit, the profile's on a replacement. */
function productFitted(job: Matched, choice: Choice): string | null {
  if (job.one_visit) return choice;
  if (job.type === "first_fit") return job.service?.tier ?? null;
  return job.profile?.fit.product ?? null;
}

type Fit = NonNullable<NonNullable<Job["profile"]>["fit"]>;

/** What a hair system is matched on: the product, the base, colour, grey and density. */
type MatchFit = Pick<
  Fit,
  "product" | "base_width_in" | "base_length_in" | "colour" | "grey_percent" | "density_percent"
>;

/** A job with the profile its kit is matched to: the card's, or one measured on the phone that has not landed. */
type Matched = Omit<Pick<Job, "kit_hair_systems" | "service" | "one_visit" | "type">, never> & {
  readonly profile: { readonly fit: MatchFit } | null;
};

/**
 * The profile the kit is matched to (docs/decisions/0245-the-steps.md): the one the phone measured and still holds,
 * as with no signal, else the card's. The phone's is what was measured on the head today.
 */
export function profileToMatch(job: Job, queued: readonly Queued[]): Matched["profile"] {
  const held = queued.filter(
    (event) => event.job_id === job.id && event.kind === "profile" && event.state !== "superseded",
  );
  const fit = (held.at(-1)?.body as { readonly fit?: MatchFit } | null | undefined)?.fit;
  return fit === undefined ? job.profile : { fit };
}

/** Whether a kit hair system is made to the profile's base, colour, grey and density exactly. */
const madeTo = (each: KitHairSystem, fit: MatchFit): boolean =>
  each.base_width_in === fit.base_width_in &&
  each.base_length_in === fit.base_length_in &&
  each.colour === fit.colour &&
  each.grey_percent === fit.grey_percent &&
  each.density_percent === fit.density_percent;

/**
 * Whether the kit hair system chosen is not the one this fit is for: another product than the one paid for or chosen,
 * or, with a hair profile, made to another fit. False for none chosen, or a piece from elsewhere.
 */
function otherThanFitted(job: Matched, choice: Choice, stock: string | null): boolean {
  const hairSystem = job.kit_hair_systems.find((each) => each.code === stock);
  if (hairSystem === undefined) return false;
  const product = productFitted(job, choice);
  const fit = job.profile?.fit ?? null;
  return (product !== null && hairSystem.product !== product) || (fit !== null && !madeTo(hairSystem, fit));
}

/**
 * Whether the kit hair system read is the one this fit is for, the product and made to the profile; null where nothing
 * tells: a piece from elsewhere, or no profile to match.
 */
export function kitMatch(job: Matched, choice: Choice, stock: string | null): boolean | null {
  if (job.profile === null || !job.kit_hair_systems.some((each) => each.code === stock)) return null;
  return !otherThanFitted(job, choice, stock);
}

/** How many pieces of the kit hair system read the kit keeps once it is fitted; null for a piece from elsewhere. */
export function leftAfter(job: Pick<Job, "kit_hair_systems">, stock: string | null): number | null {
  const held = job.kit_hair_systems.find((each) => each.code === stock)?.held;
  return held === undefined ? null : Math.max(held - 1, 0);
}

/**
 * The kit's hair systems, those made to the client's profile first: the product the client chose on a one visit, paid
 * for on a first fit, or the profile's on a replacement, and the profile's base, colour, grey and density exactly.
 */
export function kitChoices(
  job: Matched,
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
function expiredInKit(job: Pick<Job, "kit_hair_systems" | "date">, label: string): boolean {
  const piece = kitPieceOf(job, label);
  return piece !== null && piece.expires_on !== null && piece.expires_on < job.date;
}

/** What the label warns of: a piece of the kit that has expired, or a hair system not the one this fit is for. */
export function labelWarning(job: Matched & Pick<Job, "date">, form: PieceForm): string | null {
  if (expiredInKit(job, form.code)) return copy.piece.expired;
  return otherThanFitted(job, form.choice, form.stock) ? copy.piece.otherThanFitted : null;
}

/**
 * What a new label sets: a kit piece's hair system, and the lot a kit piece fills in, which follows the label. A lot the
 * technician typed stays; the step's own label passes none, as lots are no longer typed.
 */
function afterLabel(
  job: Pick<Job, "kit_hair_systems">,
  was: { readonly code: string; readonly lot: string },
  label: string,
): { readonly stock: string | null; readonly lot: string } {
  const filled = kitPieceOf(job, was.code)?.lot_code ?? null;
  const piece = kitPieceOf(job, label);
  const typed = given(was.lot) && was.lot !== filled;
  return { stock: piece?.stock ?? null, lot: typed ? was.lot : (piece?.lot_code ?? "") };
}

/**
 * What the step holds once a label is read or typed: its base, lot and hair system follow it, never the label's before
 * it. A piece of the kit gives its hair system, whose name is its base, and its lot, with or without signal; the lookup
 * fills them for one from elsewhere. Kit stock with no labels, picked from the kit, stays picked.
 */
export function labelTaken(
  job: Pick<Job, "kit_hair_systems">,
  stock: string | null,
  label: string,
): { readonly stock: string | null; readonly base: string; readonly lot: string } {
  const next = afterLabel(job, { code: "", lot: "" }, label);
  const picked = job.kit_hair_systems.find((each) => each.code === stock && each.units.length === 0) ?? null;
  const fromKit = job.kit_hair_systems.find((each) => each.code === next.stock) ?? null;
  return { stock: next.stock ?? picked?.code ?? null, base: fromKit?.name ?? "", lot: next.lot };
}

/** Whether a one visit's client decided against the fit, which fits nothing and asks for no label. */
const declinedTheFit = (form: PieceForm, job: Pick<Job, "one_visit">): boolean =>
  job.one_visit && form.choice === DECLINED;

/** Whether a one visit's client chose a product and booked its fit for another day, which fits nothing today. */
const fitLater = (form: PieceForm, job: Pick<Job, "one_visit">): boolean =>
  job.one_visit && form.later && form.choice !== null && form.choice !== DECLINED;

/** Whether the technician's kit holds a piece of the product, which a one visit's fit today needs. */
export const inKit = (job: Pick<Job, "kit_hair_systems">, product: string): boolean =>
  job.kit_hair_systems.some((each) => each.product === product && each.held > 0);

/** Whether the step fits nothing today, so asks for no label: the fit declined, or booked for later. */
export const fitsNothingToday = (form: PieceForm, job: Pick<Job, "one_visit">): boolean =>
  declinedTheFit(form, job) || fitLater(form, job);

/** What a label's check found: not checked yet, unknown to us, no signal to check, this client's, or another's. */
export type LabelChecked = "none" | "unknown" | "offline" | "found" | "another_client";

/**
 * What still keeps Next dim, in the words it says instead; null once the step can go. A fit goes on with a label of the
 * kit's, a row picked whose pieces carry none in our records, or a label checked as this client's piece; with no signal
 * to check it, as typed.
 */
export function stillMissing(
  form: PieceForm,
  job: Pick<Job, "one_visit" | "kit_hair_systems" | "date">,
  checked: LabelChecked,
): string | null {
  if (job.one_visit && form.choice === null) return oneVisit.chooseFirst;
  // Fitting nothing today asks for no label, so a label left typed holds nothing back.
  if (fitsNothingToday(form, job)) return null;
  // A one visit fits today only a hair system the kit holds; one it does not is booked for later.
  if (job.one_visit && form.choice !== null && !inKit(job, form.choice)) return oneVisit.notInKitAction;
  if (expiredInKit(job, form.code)) return copy.piece.expiredAction;
  if (!isLabel(form.code)) return copy.piece.checkFirst;
  if (checked === "another_client") return copy.piece.notThisClientAction;
  // A row picked whose pieces carry no labels in our records takes the label on the piece; one whose pieces do, only one
  // of theirs.
  const unlabelled = job.kit_hair_systems.some((each) => each.code === form.stock && each.units.length === 0);
  const fromKit = unlabelled || kitPieceOf(job, form.code) !== null;
  if (!fromKit && checked === "none") return copy.piece.uncheckedAction;
  if (!fromKit && checked === "unknown") return copy.piece.notInKitAction;
  return given(form.oldCode) && !isLabel(form.oldCode) ? copy.piece.checkFirst : null;
}

/** The step's body: against the fit, or the piece with what was said of it, and on a replacement the one off. */
export function pieceBody(form: PieceForm, job: Pick<Job, "one_visit">): EventBody<"piece"> {
  if (declinedTheFit(form, job)) return { declined: true };
  if (fitLater(form, job) && form.choice !== null) return { product: form.choice, fit_later: true };
  return {
    piece_code: form.code,
    ...(job.one_visit && form.choice !== null ? { product: form.choice } : {}),
    ...(given(form.base) ? { base: form.base.trim() } : {}),
    ...(given(form.lot) ? { supplier_lot: form.lot.trim() } : {}),
    ...(form.stock === null ? {} : { stock_code: form.stock }),
    ...(given(form.oldCode) ? { old_piece: { piece_code: form.oldCode } } : {}),
  };
}
