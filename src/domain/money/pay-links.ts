// A payment link as the client is sent it on WhatsApp (docs/decisions/0300-payment-links-on-whatsapp.md): kept under a
// random token our own address, /pay/<token>, sends on to Razorpay's link while it is open, and the message queued.
// Sending it again queues the message again, under the same token.

import { indiaClock, indiaDate, shortDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { VISIT_TYPE_NAMES, type VisitType } from "../../config/visit-types.ts";
import { toBase64Url } from "../../lib/base64url.ts";
import { firstNameOf } from "../../lib/names.ts";
import { insertRow } from "../../lib/sql.ts";
import { queueMessage } from "../messages/queued-messages.ts";
import { isSpent, takeOne, type CountedAt } from "../sign-in/rate-limit.ts";

/** What a link pays for, by our key for it. */
export interface PayLinkSubject {
  readonly kind: "hold" | "custom_order" | "payment_link";
  readonly id: string;
}

export interface PayLinkMade {
  readonly personId: string;
  readonly subject: PayLinkSubject;
  /** Razorpay's own address for the link. */
  readonly url: string;
  readonly amount: number;
  /** What it pays for, as the message says it after "for your": "service visit on Thu 23 Sep". */
  readonly what: string;
  readonly openUntil: Date;
}

/** A visit as the message names what its link pays for: "service visit on Thu 23 Sep, 12 pm". */
export function visitPaidFor(visit: {
  readonly kind: VisitType;
  readonly date: string;
  readonly startsAt: Date | null;
}) {
  const at = visit.startsAt === null ? "" : `, ${indiaClock(visit.startsAt.toISOString())}`;
  return `${VISIT_TYPE_NAMES[visit.kind].toLowerCase()} on ${shortDate(visit.date)}${at}`;
}

/** 128 random bits: the end of the address the message's button opens. */
const newToken = (): string => toBase64Url(crypto.getRandomValues(new Uint8Array(16)));

const messageOf = (db: D1Database, personId: string, token: string, at: string) =>
  queueMessage(db, {
    id: crypto.randomUUID(),
    personId,
    kind: "payment_link",
    subject: { kind: "pay_link", id: token },
    at,
  });

/** A link just made: kept under a new token, and its message queued. */
export function payLinkStatements(db: D1Database, made: PayLinkMade, now: Date): D1PreparedStatement[] {
  const token = newToken();
  const at = now.toISOString();
  return [
    insertRow(db, "pay_links", {
      id: token,
      person_id: made.personId,
      subject_kind: made.subject.kind,
      subject_id: made.subject.id,
      url: made.url,
      amount: made.amount,
      what: made.what,
      open_until: made.openUntil.toISOString(),
      made_at: at,
    }),
    messageOf(db, made.personId, token, at),
  ];
}

/** The message queued again for a link sent again, under the token it went with; false for one never sent so. */
export async function payLinkSentAgain(db: D1Database, subject: PayLinkSubject, now: Date): Promise<boolean> {
  const sent = await db
    .prepare(
      `SELECT id, person_id FROM pay_links INDEXED BY pay_links_by_subject
       WHERE subject_kind = ?1 AND subject_id = ?2 AND open_until > ?3 ORDER BY made_at DESC LIMIT 1`,
    )
    .bind(subject.kind, subject.id, now.toISOString())
    .first<{ id: string; person_id: string }>();
  if (sent === null) return false;
  await messageOf(db, sent.person_id, sent.id, now.toISOString()).run();
  return true;
}

/** Whether this address has used up its misses this hour: tokens closed or never made. Counts nothing. */
export const payLinkMissesSpent = (db: D1Database, ipHash: string, at: CountedAt): Promise<boolean> =>
  isSpent(db, "pay_link_miss:ip", ipHash, at);

export async function countPayLinkMiss(db: D1Database, ipHash: string, at: CountedAt): Promise<void> {
  await takeOne(db, "pay_link_miss:ip", ipHash, at);
}

/** Razorpay's address a token sends the client on to, while its link is open; null for a token closed or never made. */
export async function openPayLink(db: D1Database, token: string, now: Date): Promise<string | null> {
  const link = await db
    .prepare("SELECT url FROM pay_links WHERE id = ?1 AND open_until > ?2")
    .bind(token, now.toISOString())
    .first<{ url: string }>();
  return link?.url ?? null;
}

/**
 * The message for a token: {{1}} the first name, {{2}} the amount, {{3}} what it pays for, {{4}} until when, and {{5}}
 * our address for it, which the approved template draws as its button. Skipped once the link has closed.
 */
export async function composePaymentLink(
  db: D1Database,
  sent: { readonly token: string; readonly personId: string; readonly origin: string },
  now: Date,
): Promise<{ readonly template: "payment_link_v1"; readonly params: string[] } | { readonly skip: string }> {
  const link = await db
    .prepare(
      `SELECT l.amount, l.what, l.open_until, p.name FROM pay_links l JOIN people p ON p.id = l.person_id
       WHERE l.id = ?1 AND l.person_id = ?2`,
    )
    .bind(sent.token, sent.personId)
    .first<{ amount: number; what: string; open_until: string; name: string }>();
  if (link === null) return { skip: "no such payment link" };
  if (link.open_until <= now.toISOString()) return { skip: "the payment link has closed" };
  const until = `${shortDate(indiaDate(link.open_until))}, ${indiaClock(link.open_until)}`;
  return {
    template: "payment_link_v1",
    params: [firstNameOf(link.name), rupees(link.amount), link.what, until, `${sent.origin}/pay/${sent.token}`],
  };
}
