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

import type { Logger } from "../log.ts";
import type { Alert } from "../providers/alerts.ts";
import type { BooksProvider } from "../providers/books.ts";
import type { FsmProvider } from "../providers/fsm.ts";
import { ZohoError } from "../providers/zoho-http.ts";

/** How many a pass bills, well inside a cron run's outside calls. */
export const PER_PASS = 5;
export const RECHECK_AFTER_MS = 60 * 60 * 1000;

/** How many invoices this pass raised, and how many became documents the client may see. */
export type InvoiceSummary = { raised: number; issued: number };

/** FSM refuses it: a 4xx, which asking again at once will not change. */
const refused = (error: unknown): error is ZohoError =>
  error instanceof ZohoError && error.status >= 400 && error.status < 500;

/** A draft is not a valid tax invoice, and a voided one is no longer one; anything else has been issued. */
const isIssued = (status: string) => status !== "draft" && status !== "void";

export async function raiseInvoices(
  db: D1Database,
  fsm: FsmProvider,
  books: BooksProvider,
  now: Date,
  log: Logger,
  alert: Alert,
): Promise<InvoiceSummary> {
  const at = now.toISOString();
  const recheck = new Date(now.getTime() - RECHECK_AFTER_MS).toISOString();
  const { results } = await db
    .prepare(
      `SELECT id, fsm_work_order_id FROM appointments
       WHERE status = 'completed' AND invoice_issued_at IS NULL AND fsm_work_order_id IS NOT NULL
         AND deleted_at IS NULL AND (invoice_checked_at IS NULL OR invoice_checked_at < ?1)
       ORDER BY window_start LIMIT ?2`,
    )
    .bind(recheck, PER_PASS)
    .all<{ id: string; fsm_work_order_id: string }>();

  const summary: InvoiceSummary = { raised: 0, issued: 0 };
  const markIssued = (appointmentId: string) =>
    db.prepare("UPDATE appointments SET invoice_issued_at = ?1 WHERE id = ?2").bind(at, appointmentId).run();

  for (const appointment of results) {
    let invoice = null;
    try {
      invoice = await fsm.invoiceWorkOrder(appointment.fsm_work_order_id);
    } catch (error) {
      if (!refused(error)) throw error;
      log.warn("invoice_refused", { appointment_id: appointment.id, status: error.status, code: error.code });
    }
    if (invoice === null) {
      await db.prepare("UPDATE appointments SET invoice_checked_at = ?1 WHERE id = ?2").bind(at, appointment.id).run();
      continue;
    }

    // Kept before it is sent: losing the ID here would have the next pass raise a second invoice for the job.
    await db
      .prepare("UPDATE appointments SET fsm_invoice_id = ?1, invoice_checked_at = ?2 WHERE id = ?3")
      .bind(invoice.booksInvoiceId, at, appointment.id)
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
      const held = await books.invoice(invoice.booksInvoiceId);
      if (held !== null && isIssued(held.status)) {
        await markIssued(appointment.id);
        summary.issued += 1;
      }
      continue;
    }

    summary.raised += 1;
    try {
      await books.issueInvoice(invoice.booksInvoiceId);
    } catch (error) {
      // The client is shown nothing rather than a draft, and the send is not tried again by the rule above.
      log.warn("invoice_not_issued", { appointment_id: appointment.id, error });
      await alert(
        `Books would not mark invoice ${invoice.booksInvoiceId} sent, so visit ${appointment.id} has no tax ` +
          "invoice the client can open. Send it in Books, and nothing here will send it again.",
      );
      continue;
    }
    await markIssued(appointment.id);
    summary.issued += 1;
  }
  return summary;
}
