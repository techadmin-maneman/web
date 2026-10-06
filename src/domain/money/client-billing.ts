// A client's payment links and the invoices of their finished visits, as ops read them on the client's Payments tab.
//
// A link is one of two kinds: the one a consultation and fit in one visit is paid by once the client is fitted
// (src/domain/money/payment-links.ts), or the one ops send for a visit they book from the console, kept on its hold
// (src/domain/booking/visit-booking.ts).

import type { VisitType } from "../../config/visit-types.ts";
import { indiaDate } from "../../lib/india-time.ts";
import { closedIfSentBy } from "../../policy/one-visit.ts";

export const LINK_STATES = ["making", "open", "paid", "refused", "lapsed"] as const;
type LinkState = (typeof LINK_STATES)[number];

export const INVOICE_STATES = ["to_raise", "draft", "issued"] as const;
type InvoiceState = (typeof INVOICE_STATES)[number];

interface LinkRow {
  id: string;
  product: string;
  /** A one visit's link: when its visit started. */
  visit_start: string | null;
  /** A hold's link: India's date the visit was booked for. */
  visit_date: string | null;
  amount: number;
  reference: string | null;
  short_url: string | null;
  created_at: string;
  sent_at: string | null;
  paid_at: string | null;
  refused_at: string | null;
  lapsed: number;
}

interface InvoiceRow {
  id: string;
  window_start: string;
  type: VisitType;
  fsm_invoice_id: string | null;
  invoice_issued_at: string | null;
}

// A one visit's link closes unpaid a set number of days after Razorpay made it.
const ONE_VISIT_LINKS = `SELECT l.id, COALESCE(s.name, l.tier) AS product,
    a.window_start AS visit_start, NULL AS visit_date,
    l.amount, l.reference, l.short_url, l.created_at, l.sent_at, l.paid_at, l.refused_at,
    COALESCE(l.sent_at <= ?2, 0) AS lapsed
  FROM payment_links l
  JOIN appointments a ON a.id = l.appointment_id
  LEFT JOIN services s ON s.kind = 'first_fit' AND s.tier = l.tier
  WHERE a.person_id = ?1`;

// A hold's link is made, and texted, as ops book the visit; a hold let go or run out unpaid has lapsed.
const BOOKING_LINKS = `SELECT h.id, COALESCE(s.name, h.type) AS product,
    NULL AS visit_start, h.date AS visit_date,
    h.amount, h.reference, h.payment_link_url AS short_url, h.created_at, h.created_at AS sent_at,
    (SELECT MIN(p.created_at) FROM payments p
      WHERE p.razorpay_order_id = h.razorpay_order_id AND p.status != 'failed') AS paid_at,
    NULL AS refused_at, h.state = 'released' AS lapsed
  FROM slot_holds h
  LEFT JOIN services s ON s.kind = h.type AND s.tier = h.tier
  WHERE h.person_id = ?1 AND h.pay_by_link = 1 AND h.payment_link_url IS NOT NULL`;

// The visits the invoice passes bill: finished, sold for a price, and not a one visit the client declined.
const BILLED_VISITS = `SELECT a.id, a.window_start, a.type, a.fsm_invoice_id, a.invoice_issued_at
  FROM appointments a
  WHERE a.person_id = ?1 AND a.status = 'completed' AND a.deleted_at IS NULL AND a.window_start IS NOT NULL
    AND a.type IN ('first_fit', 'service', 'replacement') AND a.one_visit IS NOT 'declined'
  ORDER BY a.window_start DESC`;

function linkStateOf(row: LinkRow): LinkState {
  if (row.paid_at !== null) return "paid";
  if (row.refused_at !== null) return "refused";
  if (row.lapsed === 1) return "lapsed";
  return row.short_url === null ? "making" : "open";
}

function visitDateOf(row: LinkRow): string | null {
  if (row.visit_date !== null) return row.visit_date;
  return row.visit_start === null ? null : indiaDate(new Date(row.visit_start));
}

const linkOf = (row: LinkRow) => ({
  id: row.id,
  product: row.product,
  visit_date: visitDateOf(row),
  amount: row.amount,
  reference: row.reference,
  short_url: row.short_url,
  sent_at: row.sent_at,
  state: linkStateOf(row),
  paid_at: row.paid_at,
});

/** Every payment link the client was sent or is owed, the newest first. */
export async function paymentLinksOf(db: D1Database, personId: string, now: Date) {
  const [oneVisit, booking] = await Promise.all([
    db.prepare(ONE_VISIT_LINKS).bind(personId, closedIfSentBy(now).toISOString()).all<LinkRow>(),
    db.prepare(BOOKING_LINKS).bind(personId).all<LinkRow>(),
  ]);
  return [...oneVisit.results, ...booking.results].sort((a, b) => b.created_at.localeCompare(a.created_at)).map(linkOf);
}

function invoiceStateOf(row: InvoiceRow): InvoiceState {
  if (row.invoice_issued_at !== null) return "issued";
  return row.fsm_invoice_id === null ? "to_raise" : "draft";
}

/** Where each finished visit's invoice stands in Books, the latest visit first. */
export async function visitInvoicesOf(db: D1Database, personId: string) {
  const { results } = await db.prepare(BILLED_VISITS).bind(personId).all<InvoiceRow>();
  return results.map((row) => ({
    visit_id: row.id,
    date: indiaDate(new Date(row.window_start)),
    type: row.type,
    state: invoiceStateOf(row),
    issued_at: row.invoice_issued_at,
  }));
}
