// The invoice for a finished job (docs/decisions/0055-invoices.md). FSM raises
// it and Books holds it, so `appointments.fsm_invoice_id` keeps
// Books' ID: that is what the client app's tax invoice is streamed from.
//
// On the five-minute cron, with the Books pass and never in a client's path.
// Each run offers a few finished visits we hold no invoice for. FSM gives one
// invoice per work order however often it is asked, so a job the owner
// invoiced by hand in FSM's own screen comes back with that invoice rather
// than a second one. A work order FSM will not bill — a free consultation —
// waits an hour before it is offered again.

import type { Logger } from "../log.ts";
import type { FsmProvider } from "../providers/fsm.ts";
import { ZohoError } from "../providers/zoho-http.ts";

/** How many a pass bills, well inside a cron run's outside calls. */
export const PER_PASS = 5;
export const RECHECK_AFTER_MS = 60 * 60 * 1000;

/** How many visits now have their invoice, whoever raised it. */
export type InvoiceSummary = { invoiced: number };

/** FSM refuses it: a 4xx, which asking again at once will not change. */
const refused = (error: unknown): error is ZohoError =>
  error instanceof ZohoError && error.status >= 400 && error.status < 500;

export async function raiseInvoices(db: D1Database, fsm: FsmProvider, now: Date, log: Logger): Promise<InvoiceSummary> {
  const at = now.toISOString();
  const recheck = new Date(now.getTime() - RECHECK_AFTER_MS).toISOString();
  const { results } = await db
    .prepare(
      `SELECT id, fsm_work_order_id FROM appointments
       WHERE status = 'completed' AND fsm_invoice_id IS NULL AND fsm_work_order_id IS NOT NULL
         AND deleted_at IS NULL AND (invoice_checked_at IS NULL OR invoice_checked_at < ?1)
       ORDER BY window_start LIMIT ?2`,
    )
    .bind(recheck, PER_PASS)
    .all<{ id: string; fsm_work_order_id: string }>();

  let invoiced = 0;
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
    await db
      .prepare("UPDATE appointments SET fsm_invoice_id = ?1, invoice_checked_at = ?2 WHERE id = ?3")
      .bind(invoice.booksInvoiceId, at, appointment.id)
      .run();
    invoiced += 1;
  }
  return { invoiced };
}
