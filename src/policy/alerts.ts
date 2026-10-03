// Who acts on an alert (src/domain/alerts.ts) on the Tasks board's "Needs a hand", and which alerts' work ops may
// send again from there. An alert's kind is its key up to the first colon: "crm_lead:<leadId>" is a crm_lead.

import type { Department, Level } from "./access.ts";

export const alertKind = (key: string): string => key.split(":", 1)[0] ?? key;

/** What the alert is about, after its kind: the lead's ID in "crm_lead:<leadId>". */
export const alertSubject = (key: string): string => key.slice(alertKind(key).length + 1);

/** A WhatsApp message that failed for good. */
export const messageFailedKey = (messageId: string): string => `message_failed:${messageId}`;
/** A lead the CRM sync gave up on. */
export const crmLeadKey = (leadId: string): string => `crm_lead:${leadId}`;
/** An erased person whose CRM record the sync gave up blanking. */
export const crmErasureKey = (personId: string): string => `crm_erasure:${personId}`;
/** A deletion request near the end of the days it must be decided in. */
export const deletionWaitingKey = (requestId: string): string => `deletion_waiting:${requestId}`;

const CUSTOMER_CARE_KINDS = [
  "message_failed",
  "messages_unsent",
  "crm_lead",
  "crm_erasure",
  "crm_contact_update",
  "contact_sync",
  "deletion_waiting",
  "books_erasure",
  "fsm_erasure",
  "fsm_contact_update",
  "client_note_fsm",
];

const FINANCE_KINDS = [
  "cancel_refund_failed",
  "no_show_refund_failed",
  "no_show_credit_not_back",
  "credit_visit_without_credit",
  "hold_link_without_order",
  "payment_link",
  "payment_link_failed",
  "invoice_draft",
  "invoice_unpriced",
  "invoice_refused",
  "invoice_failed",
  "books_item",
  "books_unapplied",
  "books_customer_refused",
  "books_customer_failed",
  "books_customer_update_refused",
  "books_customer_update_failed",
  "books_payment_refused",
  "books_payment_failed",
  "books_apply_refused",
  "books_apply_failed",
  "books_refund_refused",
  "books_refund_failed",
];

const OPERATIONS_KINDS = [
  "low_stock",
  "technician_code_refused",
  "hair_profile_from_older",
  "unbooked_hold",
  "booking_held",
  "booking_to_link",
  "work_order_lookup_failed",
  "replaced_after_begun",
  "replaced_not_cancelled",
  "fsm_sync",
  "job_event_pending",
];

const DEPARTMENT_OF_KIND: ReadonlyMap<string, Department> = new Map([
  ...CUSTOMER_CARE_KINDS.map((kind) => [kind, "customer_care"] as const),
  ...FINANCE_KINDS.map((kind) => [kind, "finance"] as const),
  ...OPERATIONS_KINDS.map((kind) => [kind, "operations"] as const),
]);

/**
 * The department whose people see the alert and act on it. Any kind not listed is about the system itself (a cron
 * job, the WhatsApp bridge, Cloudflare's allowances), which is Admin's.
 */
export const alertDepartment = (kind: string): Department => DEPARTMENT_OF_KIND.get(kind) ?? "admin";

/**
 * The level marking an alert done asks. Done on a CRM erasure records the person erased there, and erasures are
 * Manage; any other alert only closes.
 */
export const markDoneLevel = (kind: string): Level => (kind === "crm_erasure" ? "manage" : "act");

/** The kinds whose work can be sent again: the message, the lead to the CRM, or the erasure there. */
export const SENT_AGAIN_KINDS = ["message_failed", "crm_lead", "crm_erasure"] as const;
export type SentAgainKind = (typeof SENT_AGAIN_KINDS)[number];

export const maySendAgain = (kind: string): kind is SentAgainKind =>
  (SENT_AGAIN_KINDS as readonly string[]).includes(kind);
