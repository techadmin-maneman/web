// What a refused step sent, read back so the screen putting it right starts from it rather than blank. The outbox
// keeps a step's body as it was queued, with no type, so each part is checked before it is used.

import type { ChecklistRequest, OutcomeRequest, PieceDeclined, PieceFitted } from "../api.ts";
import type { Queued } from "../store/outbox.ts";

/** A request's fields by name, each still to be checked. */
type Unchecked<T> = { readonly [K in keyof T]?: unknown };

type Fields = Readonly<Record<string, unknown>>;

const fieldsOf = (value: unknown): Fields | null =>
  typeof value === "object" && value !== null ? (value as Fields) : null;

const textOf = (value: unknown): string => (typeof value === "string" ? value : "");

/** The checklist items the refused step ticked, of those the card still lists. */
export function checklistSent(refused: Queued | null, listed: readonly string[]): string[] {
  const sent: Unchecked<ChecklistRequest> | null = fieldsOf(refused?.body);
  const done = sent?.done;
  if (!Array.isArray(done)) return [];
  return done.filter((item): item is string => typeof item === "string" && listed.includes(item));
}

export interface PieceSent {
  readonly declined: boolean;
  /** A one visit's product, by its tier; null where none was sent. */
  readonly product: string | null;
  readonly code: string;
  readonly base: string;
  readonly lot: string;
  readonly oldCode: string;
  readonly oldReason: string;
}

/** The piece the refused step sent, or null where there is no refused step. */
export function pieceSent(refused: Queued | null): PieceSent | null {
  const sent: Unchecked<PieceFitted & PieceDeclined> | null = fieldsOf(refused?.body);
  if (sent === null) return null;
  const old: Unchecked<NonNullable<PieceFitted["old_piece"]>> | null = fieldsOf(sent.old_piece);
  return {
    declined: sent.declined === true,
    product: typeof sent.product === "string" ? sent.product : null,
    code: textOf(sent.piece_code),
    base: textOf(sent.base),
    lot: textOf(sent.supplier_lot),
    oldCode: textOf(old?.piece_code),
    oldReason: textOf(old?.failure_reason),
  };
}

type PartialOutcome = Extract<OutcomeRequest, { outcome: "partial" }>;

export interface OutcomeSent {
  readonly choice: OutcomeRequest["outcome"];
  /** A partial's reason, when the card still offers it. */
  readonly reason: string | null;
}

/** The outcome the refused step sent, or null where there is none to start from. */
export function outcomeSent(refused: Queued | null, offered: readonly string[]): OutcomeSent | null {
  const sent: Unchecked<PartialOutcome> | null = fieldsOf(refused?.body);
  if (sent?.outcome === "done") return { choice: "done", reason: null };
  if (sent?.outcome !== "partial") return null;
  const reason = typeof sent.reason === "string" && offered.includes(sent.reason) ? sent.reason : null;
  return { choice: "partial", reason };
}
