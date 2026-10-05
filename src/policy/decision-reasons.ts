// Why ops decided what they did about a client (docs/prompts/phase2-backend.md,
// "Pieces tab"; docs/prompts/phase2-frontend.md, the no-show queue and board C1).
//
// The console asked for a reason wherever the prompts do, but only the browser
// insisted, so a grant of credits could be approved, and a client charged, with
// no reason at all. Every route below now refuses such a decision itself.
//
// The reason is kept with the decision, beside who made it. It is not written
// to the audit log, which holds IDs, counts and codes only and can never be
// blanked when the client is erased (docs/decisions/0031-access-and-audit.md);
// the log's entry names the decision, and the decision holds its reason.

import { isOneOf } from "../lib/one-of.ts";

export const RULES = ["Referral review queue: approve or reject, with the reason recorded."] as const;

/** The same rule in the frontend prompt's words, for the two queues that charge a client or grant one credits. */
export const CONSOLE_RULES = ["Charge or waive, with a reason.", "Both require a reason."] as const;

/**
 * Which decisions need a reason, queue by queue. Everything that charges,
 * grants or refuses the client does; confirming a number change or erasing an
 * account does only what the client asked for.
 */
const NEEDS_A_REASON = {
  referral: ["approve", "reject"],
  no_show: ["charged", "waived"],
  // A disputed charge, refunded or upheld (src/policy/no-show.ts, RULES[6]).
  no_show_dispute: ["refunded", "upheld"],
  number_change: ["reject"],
  deletion: ["reject"],
} as const;

type ReasonedQueue = keyof typeof NEEDS_A_REASON;

/** The longest reason kept: a sentence or two, not a case file. */
export const REASON_MAX_CHARS = 300;

export const needsReason = (queue: ReasonedQueue, decision: string): boolean =>
  isOneOf(NEEDS_A_REASON[queue], decision);

/**
 * How long the client's profile shows ops' decision on a change of number, or their rejection of a request to delete
 * the account, with its reason. PLACEHOLDER, until the owner says otherwise.
 */
export const DECISION_SHOWN_DAYS = 30;
