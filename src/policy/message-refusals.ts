// A WhatsApp message WhatsApp refused after the provider took it (docs/decisions/0276-a-message-whatsapp-refuses.md):
// marked failed with WhatsApp's code, which says why, as 131049, its cap on marketing messages to one person. Care
// tell the client another way, except for the messages that offer rather than inform, which stay marketing.

import type { MessageKind } from "../config/message-kinds.ts";

/** What a refused message's `last_error` starts with; WhatsApp's code follows where the report gave one. */
const REFUSED = "refused";

/** WhatsApp's code at the head of MSG91's reason, "131049: This message was not delivered…"; null for none. */
export function refusalCodeOf(reason: string | null | undefined): string | null {
  return /^\s*(\d{3,6})\b/.exec(reason ?? "")?.[1] ?? null;
}

/** The `last_error` a refused message keeps: "refused 131049", or "refused" where no code came. */
export const refusalError = (code: string | null): string => (code === null ? REFUSED : `${REFUSED} ${code}`);

/** Whether a failed message was refused after it was sent, rather than never sent. */
export const wasRefused = (lastError: string | null): boolean =>
  lastError === REFUSED || (lastError?.startsWith(`${REFUSED} `) ?? false);

/**
 * The messages whose refusal Care do not chase: what offers rather than informs (the referral thanks, the launch,
 * the next visit's reminder, the waitlist's word), which stay marketing; the answer to a STOP; a move's word, which
 * Operations already chase as a move the client has not heard of or not answered; and a word for the moment, the
 * technician arriving or on the way, which is no use by the time Care could act.
 */
export const REFUSALS_NOT_CHASED = [
  "launch_alert",
  "next_service_reminder",
  "friend_fitted",
  "friend_credited",
  "waitlist_confirmation",
  "messages_stopped",
  "visit_moved",
  "move_proposed",
  "arrival_notice",
  "technician_update",
] as const satisfies readonly MessageKind[];

export const REFUSED_MESSAGES_KEYS = ["share", "least"] as const;
/**
 * When a kind of message is refused too often (docs/decisions/0277-alerts-that-come-sooner.md): the share of a day's
 * messages of a kind WhatsApp refused, in per cent, from which Care are told, counted once at least so many were sent.
 * Ops set them in Settings.
 */
export type RefusedMessages = Readonly<Record<(typeof REFUSED_MESSAGES_KEYS)[number], number>>;

export const REFUSED_MESSAGES: RefusedMessages = { share: 20, least: 5 };
