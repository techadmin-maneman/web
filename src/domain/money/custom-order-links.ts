// A custom order's payment link (docs/decisions/0174-custom-orders.md): the whole price, asked of Razorpay once the
// order is raised and texted to the client, under the order's ID as its reference; and, once Razorpay says it is paid,
// the payment recorded as the client's, the order marked paid and its purchase order drafted
// (src/domain/field/custom-order-po.ts). Nothing goes to the supplier before then.

import { onAllowlist } from "../../config/settings.ts";
import { failureReason } from "../../log.ts";
import { paymentLinkClosesAt } from "../../policy/one-visit.ts";
import { readOpsInputs } from "../ops/ops-settings.ts";
import type { RazorpayPayment, RazorpayPaymentLink } from "../../providers/payments/razorpay.ts";
import { isRefusal } from "../../providers/provider-error.ts";
import { serviceOf } from "../booking/services.ts";
import { draftCustomOrderPo } from "../field/custom-order-po.ts";
import { paymentsTab } from "../ops/alerts.ts";
import type { LinkDeps } from "./payment-links.ts";
import { recordPayment } from "./payments.ts";

export type CustomLinkSent = "sent" | "already_sent" | "unavailable";

type LinkRow = {
  id: string;
  number: number;
  person_id: string;
  product: string;
  amount: number;
  state: string;
  link_sent_at: string | null;
  name: string;
  mobile_e164: string;
};

const numberOf = (number: number) => `CU-${String(number).padStart(4, "0")}`;

/** The link kept on the order. */
function keep(db: D1Database, orderId: string, made: { id: string; shortUrl: string }, now: Date) {
  return db
    .prepare(
      `UPDATE custom_orders SET razorpay_link_id = ?2, short_url = ?3, link_sent_at = ?4, updated_at = ?4
       WHERE id = ?1`,
    )
    .bind(orderId, made.id, made.shortUrl, now.toISOString())
    .run();
}

/**
 * The order's link, asked of Razorpay where none is yet and texted to the client. A refusal finds the link a try whose
 * answer never came made under the order's reference; any other failure tells ops, who send it again from its page.
 */
export async function sendCustomOrderLink(
  db: D1Database,
  deps: LinkDeps,
  orderId: string,
  now: Date,
): Promise<CustomLinkSent> {
  const order = await db
    .prepare(
      `SELECT k.id, k.number, k.person_id, k.product, k.amount, k.state, k.link_sent_at, p.name, p.mobile_e164
       FROM custom_orders k JOIN people p ON p.id = k.person_id WHERE k.id = ?1`,
    )
    .bind(orderId)
    .first<LinkRow>();
  if (order?.state !== "awaiting_payment") return "unavailable";
  if (order.link_sent_at !== null) return "already_sent";
  const product = (await serviceOf(db, "first_fit", order.product))?.name ?? order.product;
  const notify = onAllowlist(deps.messagingSettings, order.mobile_e164);
  try {
    const made = await deps.payments.createPaymentLink({
      amount: order.amount,
      reference: order.id,
      description: `${product}, made for you · ${numberOf(order.number)}`,
      customer: { name: order.name, contact: order.mobile_e164 },
      notes: { custom_order_id: order.id, person_id: order.person_id },
      closesAt: paymentLinkClosesAt(now, (await readOpsInputs(db, now)).paymentLinks.pay_within_days),
      notify,
    });
    await keep(db, order.id, made, now);
    return "sent";
  } catch (error) {
    const reason = failureReason(error);
    deps.log.warn("custom_order_link_failed", { custom_order_id: order.id, reason });
    const before = isRefusal(error) ? await deps.payments.findPaymentLink(order.id) : null;
    if (before !== null) {
      await keep(db, order.id, before, now);
      return "sent";
    }
    await deps.alertOnce({
      key: `custom_order_link:${order.id}`,
      message: `The payment link for custom order ${numberOf(order.number)} could not be made: ${reason}. Send it again from the client's page.`,
      link: paymentsTab(order.person_id),
    });
    return "unavailable";
  }
}

/** The custom order a paid link was for, by Razorpay's ID for it or by its reference; null for one not ours. */
export async function customOrderOfLink(db: D1Database, link: RazorpayPaymentLink): Promise<string | null> {
  const row = await db
    .prepare("SELECT id FROM custom_orders WHERE razorpay_link_id = ?1 OR id = ?2")
    .bind(link.id, link.reference_id ?? null)
    .first<{ id: string }>();
  return row?.id ?? null;
}

/**
 * A custom order's link paid: the payment recorded as its client's, the order marked paid, and its purchase order
 * drafted. Each step is written once, so a second word of the same payment changes nothing.
 */
export async function customOrderPaid(
  db: D1Database,
  paid: { readonly orderId: string; readonly payment: RazorpayPayment },
  hashSalt: string,
  now: Date,
): Promise<void> {
  const order = await db
    .prepare("SELECT person_id FROM custom_orders WHERE id = ?1")
    .bind(paid.orderId)
    .first<{ person_id: string }>();
  if (order === null) return;
  const notes = { custom_order_id: paid.orderId, person_id: order.person_id };
  await recordPayment({ db, payment: { ...paid.payment, notes }, status: "captured", hashSalt, now });
  await db
    .prepare(
      `UPDATE custom_orders SET state = 'paid', razorpay_payment_id = ?2, paid_at = ?3, updated_at = ?3
       WHERE id = ?1 AND state = 'awaiting_payment'`,
    )
    .bind(paid.orderId, paid.payment.id, now.toISOString())
    .run();
  await draftCustomOrderPo(db, paid.orderId, {
    actor: { kind: "system", id: "custom-order" },
    requestId: `custom-order:${paid.orderId}`,
    now,
  });
}
