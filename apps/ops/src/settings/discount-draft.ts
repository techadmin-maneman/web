// A discount code as ops are making it (./DiscountCodeForm.tsx): every box holds text until it is sent, and rupees
// become paise only then; and the check's lines, which say what will be made before anything is.

import { shortDate } from "@maneman/web-kit/dates";
import { paiseFromRupees, rupees } from "@maneman/web-kit/money";
import { isCodeText } from "../../../../src/policy/discount-codes.ts";
import type { DiscountCodesNew } from "../api.ts";
import { settings } from "../content.ts";

const copy = settings.discountCodes;

export type Kind = DiscountCodesNew["kind"];
export type Covered = DiscountCodesNew["covers"][number];

/** What a code may cover, in the order the form offers them. */
export const COVERS: readonly Covered[] = ["first_fit", "service", "replacement"];

export interface Draft {
  readonly how: "typed" | "generated";
  readonly code: string;
  readonly count: string;
  readonly kind: Kind;
  /** Per cent for a percentage; rupees for an amount. */
  readonly value: string;
  /** Rupees. */
  readonly cap: string;
  readonly covers: readonly Covered[];
  readonly expiresOn: string;
  readonly maxUses: string;
  readonly oncePerClient: boolean;
}

export const EMPTY: Draft = {
  how: "typed",
  code: "",
  count: "1",
  kind: "percent",
  value: "",
  cap: "",
  covers: [],
  expiresOn: "",
  maxUses: "",
  oncePerClient: true,
};

/** A box left empty is a limit left out. */
const optional = (text: string): string | null => (text.trim() === "" ? null : text.trim());

/** More than one generated: a batch, each code single-use. */
export const isBatch = (draft: Draft): boolean => draft.how === "generated" && Number(draft.count) > 1;

/** How many bookings each code may be on: one each for a batch, else what was typed, if anything. */
function usesOf(draft: Draft): { max_uses?: number } {
  if (isBatch(draft)) return { max_uses: 1 };
  const typed = optional(draft.maxUses);
  return typed === null ? {} : { max_uses: Number(typed) };
}

/** What the form sends: numbers and paise from its text. */
export function requestOf(draft: Draft): DiscountCodesNew {
  const cap = optional(draft.cap);
  const expiresOn = optional(draft.expiresOn);
  return {
    ...(draft.how === "typed" ? { code: draft.code.trim() } : { count: Number(draft.count) }),
    kind: draft.kind,
    value: draft.kind === "percent" ? Number(draft.value) : paiseFromRupees(draft.value),
    ...(draft.kind === "percent" && cap !== null ? { cap: paiseFromRupees(cap) } : {}),
    covers: [...draft.covers],
    ...(expiresOn === null ? {} : { expires_on: expiresOn }),
    ...usesOf(draft),
    once_per_client: draft.oncePerClient,
  };
}

/** A typed code that cannot be one, said beside its box before anything is checked; null while it can. */
export const codeError = (draft: Draft): string | null =>
  draft.how === "typed" && draft.code.trim() !== "" && !isCodeText(draft.code)
    ? (copy.errors.code ?? copy.codeHint)
    : null;

/** Whether every box the code needs is filled in: the rest the API checks, and names the box it refuses. */
export function isReady(draft: Draft): boolean {
  const named = draft.how === "typed" ? draft.code.trim() !== "" : draft.count.trim() !== "";
  return named && codeError(draft) === null && draft.value.trim() !== "" && draft.covers.length > 0;
}

/** The check's first line: the code typed, or how many are generated. */
function madeLine(draft: Draft): string {
  if (draft.how === "typed") return copy.oneTyped(draft.code.trim().toUpperCase());
  return isBatch(draft) ? copy.manyGenerated(Number(draft.count)) : copy.oneGenerated;
}

/** What each code takes off, as the check says it: "10%, at most Rs. 500", or "Rs. 1,000". */
function offWords(sent: DiscountCodesNew): string {
  if (sent.kind === "amount") return rupees(sent.value);
  const cap = sent.cap ?? null;
  return copy.percentOff(sent.value, cap === null ? null : rupees(cap));
}

/** The check's lines: what is made, what each takes off, on what, until when, and how often. */
export function checkLines(draft: Draft, sent: DiscountCodesNew): string[] {
  const covered = sent.covers.map((kind) => copy.coverNames[kind] ?? kind).join("; ");
  const lastDay = sent.expires_on ?? null;
  return [
    madeLine(draft),
    copy.off(offWords(sent)),
    copy.covering(covered),
    copy.until(lastDay === null ? null : shortDate(lastDay)),
    copy.usesLine(sent.max_uses ?? null, sent.once_per_client),
  ];
}
