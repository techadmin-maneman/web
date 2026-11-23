// The client's alerts in their app (docs/decisions/0255-client-alerts-and-push.md): which messages have one beside them,
// and how long the inbox keeps them. A push lives as long as a technician's (./tech-alerts.ts).

import type { MessageKind } from "../config/message-kinds.ts";

/**
 * Messages that are WhatsApp's alone: the site's notices to a number we know, the waitlist's confirmation, the
 * answer to a STOP, and a payment link, which the app's own cards show. Migration 0233's triggers leave out the same
 * kinds.
 */
export const WHATSAPP_ONLY = [
  "waitlist_confirmation",
  "consultation_exists",
  "book_in_app",
  "address_on_account",
  "address_not_served",
  "messages_stopped",
  "payment_link",
] as const satisfies readonly MessageKind[];

/** An alert's kind: the message it stands beside, or a technician asking the client to sign off their fit. */
export type ClientAlertKind = Exclude<MessageKind, (typeof WHATSAPP_ONLY)[number]> | "sign_off_asked";

/** How many days the inbox keeps. */
export const CLIENT_INBOX_DAYS = 30;

/** How many of a client's sessions take their pushes, the newest to subscribe; so an alert costs a few calls at most. */
export const PUSH_SESSIONS_MAX = 5;
