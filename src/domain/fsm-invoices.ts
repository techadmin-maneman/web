// The invoice for a finished job (docs/decisions/0055-invoices.md and
// 0056-issuing-the-invoice.md). FSM raises it and Books holds it, so
// `appointments.fsm_invoice_id` keeps Books' ID: that is what the client app's
// tax invoice is streamed from. It arrives in Books as a draft, and a draft is
// not a valid tax invoice, so the pass marks it sent — and only then may the
// client see it, which `invoice_issued_at` records.
//
// On the five-minute cron, with the Books pass and never in a client's path.
// Each run offers a few finished visits whose invoice is not issued yet. FSM
// gives one invoice per work order however often it is asked, so a job the
// owner invoiced by hand in FSM's own screen comes back with that invoice
// rather than a second one. A work order FSM will not bill — a free
// consultation — waits an hour before it is offered again.
//
// Each visit is handled on its own (docs/decisions/0067-alerts-and-silent-failures.md):
// one that fails waits an hour and the pass goes on to the next. Ops are told
// of a refusal at once, of any other failure on its third time, and of a draft
// the client still cannot open an hour after the visit. The Tasks board lists
// every such draft until it is sent (src/domain/tasks.ts).

import type { CallBudget } from "../lib/call-budget.ts";
import { scrubString, type Logger } from "../log.ts";
import type { BooksProvider } from "../providers/books.ts";
import type { FsmInvoice, FsmProvider } from "../providers/fsm.ts";
import { ZohoError } from "../providers/zoho-http.ts";
import type { AlertOnce, ResolveAlert } from "./alerts.ts";

/** How many a pass bills at most. */
export const PER_PASS = 5;
export const RECHECK_AFTER_MS = 60 * 60 * 1000;
/** Outside calls one visit may cost: its work order, the invoice's create or read, Books, and an alert. */
export const CALLS_PER_VISIT = 4;
/** The client is told their invoice comes within the hour of the visit. */
const DRAFT_ALERT_AFTER_MS = 60 * 60 * 1000;
/** A failure other than a refusal is told once it has happened this many times, an hour apart. */
const FAILURES_BEFORE_ALERT = 3;

/** How many invoices this pass raised, and how many became documents the client may see. */
export type InvoiceSummary = { raised: number; issued: number };

export interface InvoiceDeps {
  readonly fsm: FsmProvider;
  readonly books: BooksProvider;
  readonly alertOnce: AlertOnce;
  readonly resolveAlert: ResolveAlert;
}

/** FSM refuses it: a 4xx, which asking again at once will not change. */
const refused = (error: unknown): error is ZohoError =>
  error instanceof ZohoError && error.status >= 400 && error.status < 500;

/** A draft is not a valid tax invoice, and a voided one is no longer one; anything else has been issued. */
const isIssued = (status: string) => status !== "draft" && status !== "void";

interface Visit {
  id: string;
  person_id: string | null;
  fsm_work_order_id: string;
  window_end: string | null;
}

interface Pass {
  readonly db: D1Database;
  readonly deps: InvoiceDeps;
  readonly now: Date;
  readonly log: Logger;
}

export async function raiseInvoices(
  db: D1Database,
  deps: InvoiceDeps,
  now: Date,
  log: Logger,
  budget: CallBudget,
): Promise<InvoiceSummary> {
  const recheck = new Date(now.getTime() - RECHECK_AFTER_MS).toISOString();
  const { results } = await db
    .prepare(
      `SELECT id, person_id, fsm_work_order_id, window_end FROM appointments
       WHERE status = 'completed' AND invoice_issued_at IS NULL AND fsm_work_order_id IS NOT NULL
         AND deleted_at IS NULL AND (invoice_checked_at IS NULL OR invoice_checked_at < ?1)
       ORDER BY window_start LIMIT ?2`,
    )
    .bind(recheck, PER_PASS)
    .all<Visit>();

  const pass: Pass = { db, deps, now, log };
  const summary: InvoiceSummary = { raised: 0, issued: 0 };
  for (const visit of results) {
    if (!budget.spend(CALLS_PER_VISIT)) break;
    try {
      const done = await invoiceVisit(pass, visit);
      if (done.raised) summary.raised += 1;
      if (done.issued) summary.issued += 1;
    } catch (error) {
      await checkLater(pass, visit.id);
      await tellFailure(pass, visit, error);
    }
  }
  return summary;
}

/** One visit's invoice, raised if need be, and issued if it may be. A failure is thrown, for the pass to note. */
async function invoiceVisit(pass: Pass, visit: Visit): Promise<{ raised: boolean; issued: boolean }> {
  const { db, deps } = pass;
  const invoice = await deps.fsm.invoiceWorkOrder(visit.fsm_work_order_id);
  if (invoice === null) {
    await checkLater(pass, visit.id);
    return { raised: false, issued: false };
  }

  // Kept before it is sent: losing the ID here would have the next pass raise a second invoice for the job.
  await db
    .prepare("UPDATE appointments SET fsm_invoice_id = ?1, invoice_checked_at = ?2 WHERE id = ?3")
    .bind(invoice.booksInvoiceId, pass.now.toISOString(), visit.id)
    .run();

  if (!invoice.created) {
    /*
     * This invoice already existed: the owner raised it by hand, or an earlier
     * pass raised it and could not send it. It is never sent from here. A draft
     * can be deleted, an issued invoice only voided with a credit note, and
     * nothing here can tell a draft of ours from one the owner means to delete
     * — so the rule is absolute (ADR 0056). It becomes the client's when Books
     * says it has been issued, whoever issued it.
     */
    const held = await deps.books.invoice(invoice.booksInvoiceId);
    if (held !== null && isIssued(held.status)) {
      await markIssued(pass, visit.id);
      return { raised: false, issued: true };
    }
    if (endedOverAnHourAgo(pass, visit)) await tellDraft(pass, visit, invoice, "draft");
    return { raised: false, issued: false };
  }

  try {
    await deps.books.issueInvoice(invoice.booksInvoiceId);
  } catch (error) {
    // The client is shown nothing rather than a draft, and the send is not tried again by the rule above.
    pass.log.warn("invoice_not_issued", { appointment_id: visit.id, error });
    await tellDraft(pass, visit, invoice, "not_sent");
    return { raised: true, issued: false };
  }
  await markIssued(pass, visit.id);
  return { raised: true, issued: true };
}

function endedOverAnHourAgo(pass: Pass, visit: Visit): boolean {
  if (visit.window_end === null) return true;
  return pass.now.getTime() - Date.parse(visit.window_end) > DRAFT_ALERT_AFTER_MS;
}

/** One alert per visit whose invoice is a draft the client cannot open, whichever way it came to be one. */
async function tellDraft(pass: Pass, visit: Visit, invoice: FsmInvoice, why: "draft" | "not_sent"): Promise<void> {
  const message =
    why === "not_sent"
      ? `Books would not mark invoice ${invoice.booksInvoiceId} sent, so visit ${visit.id} has no tax invoice ` +
        "the client can open. Send it in Books, and nothing here will send it again."
      : `Invoice ${invoice.booksInvoiceId} of visit ${visit.id} is still a draft in Books an hour after the visit, ` +
        "so the client cannot open it. Send it in Books: nothing here sends a draft that already exists.";
  await pass.deps.alertOnce({ key: `invoice_draft:${visit.id}`, message, link: linkTo(visit) });
}

/** Logs it, and tells ops of a refusal at once and of any other failure on its third time. */
async function tellFailure(pass: Pass, visit: Visit, error: unknown): Promise<void> {
  const workOrder = `visit ${visit.id} (work order ${visit.fsm_work_order_id})`;
  if (refused(error)) {
    pass.log.warn("invoice_refused", { appointment_id: visit.id, status: error.status, code: error.code });
    await pass.deps.alertOnce({
      key: `invoice_refused:${visit.id}`,
      message: `FSM refused to invoice ${workOrder}: ${String(error.status)} ${error.code}. Raise its invoice in FSM by hand.`,
      link: linkTo(visit),
    });
    return;
  }
  pass.log.warn("invoice_failed", { appointment_id: visit.id, error });
  const reason = scrubString(error instanceof Error ? error.message : "unknown error").slice(0, 200);
  await pass.deps.alertOnce({
    key: `invoice_failed:${visit.id}`,
    message: `The invoice pass has failed ${String(FAILURES_BEFORE_ALERT)} times on ${workOrder}: ${reason}.`,
    link: linkTo(visit),
    after: FAILURES_BEFORE_ALERT,
  });
}

const linkTo = (visit: Visit): string => (visit.person_id === null ? "/tasks" : `/clients/${visit.person_id}`);

async function checkLater(pass: Pass, appointmentId: string): Promise<void> {
  await pass.db
    .prepare("UPDATE appointments SET invoice_checked_at = ?1 WHERE id = ?2")
    .bind(pass.now.toISOString(), appointmentId)
    .run();
}

/** The client may see it now, and whatever ops were told about it is over. */
async function markIssued(pass: Pass, appointmentId: string): Promise<void> {
  await pass.db
    .prepare("UPDATE appointments SET invoice_issued_at = ?1 WHERE id = ?2")
    .bind(pass.now.toISOString(), appointmentId)
    .run();
  for (const kind of ["invoice_draft", "invoice_refused", "invoice_failed"]) {
    await pass.deps.resolveAlert(`${kind}:${appointmentId}`);
  }
}
