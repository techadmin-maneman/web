// What the site's booking form tells a number we already know, privately on WhatsApp, since the page tells every
// number the same thing (src/policy/site-booking.ts): that it has a consultation still to happen, that it books in
// the app, that the visit goes to the address already on its account, or that we do not come to that address yet.
// Each is composed as it is sent, from how the person stands then.

import { shortDate } from "@maneman/web-kit/dates";
import { firstNameOf } from "../../lib/names.ts";
import { type MessageKind } from "../../config/message-kinds.ts";
import { consentGiven } from "../privacy/consents.ts";
import { currentAddress } from "../clients/profile.ts";
import { isServed } from "../clients/service-area.ts";
import { bookableTypes, liveVisitOf, type LiveVisit } from "../booking/availability.ts";
import { loadSlotSchedule } from "../booking/slot-times.ts";
import { hoursOfWindow, NO_VISITS_CONSENT, type Composed } from "../messages/visit-messages.ts";
import { isOneOf } from "../../lib/one-of.ts";
import { queueMessage } from "../messages/queued-messages.ts";

export type SiteNoticeKind = Extract<
  MessageKind,
  "consultation_exists" | "book_in_app" | "address_on_account" | "address_not_served"
>;

const SITE_NOTICE_KINDS: readonly SiteNoticeKind[] = [
  "consultation_exists",
  "book_in_app",
  "address_on_account",
  "address_not_served",
];

export const isSiteNoticeKind = (kind: string): kind is SiteNoticeKind => isOneOf(SITE_NOTICE_KINDS, kind);

/** A notice to a person about themselves; send its ID to the messaging queue once the statement is written. */
export function siteNotice(
  db: D1Database,
  input: { personId: string; kind: SiteNoticeKind; now: Date },
): { id: string; statement: D1PreparedStatement } {
  const id = crypto.randomUUID();
  const at = input.now.toISOString();
  const statement = queueMessage(db, {
    id,
    personId: input.personId,
    kind: input.kind,
    subject: { kind: "person", id: input.personId },
    at,
  });
  return { id, statement };
}

async function nameOf(db: D1Database, personId: string): Promise<string | null> {
  const row = await db.prepare("SELECT name FROM people WHERE id = ?1").bind(personId).first<{ name: string }>();
  return row?.name ?? null;
}

/** A consultation and fit in one visit is the client's first fit as well as their consultation, at the same time. */
async function visitName(db: D1Database, personId: string, consultation: LiveVisit): Promise<string> {
  const fit = await liveVisitOf(db, personId, "first_fit");
  const oneVisit = fit !== null && fit.date === consultation.date && fit.window === consultation.window;
  return oneVisit ? "consultation and fit" : "consultation";
}

async function consultationExists(db: D1Database, personId: string, firstName: string): Promise<Composed> {
  const live = await liveVisitOf(db, personId, "consultation");
  if (live === null) return { skip: "no consultation still to happen" };
  const hours = hoursOfWindow(live.date, live.window, await loadSlotSchedule(db));
  const params = [firstName, await visitName(db, personId, live), shortDate(live.date), hours];
  return { template: "consultation_exists_v1", params };
}

async function bookInApp(db: D1Database, personId: string, firstName: string): Promise<Composed> {
  if ((await bookableTypes(db, personId)).includes("consultation")) return { skip: "may book from the site now" };
  return { template: "book_in_app_v1", params: [firstName] };
}

async function addressOnAccount(db: D1Database, personId: string, firstName: string): Promise<Composed> {
  if ((await currentAddress(db, personId)) === null) return { skip: "no address on the account" };
  return { template: "address_on_account_v1", params: [firstName] };
}

async function addressNotServed(db: D1Database, personId: string, firstName: string): Promise<Composed> {
  const address = await currentAddress(db, personId);
  if (address === null) return { skip: "no address on the account" };
  if (await isServed(db, address.pincode)) return { skip: "we come to the address on the account now" };
  return { template: "address_not_served_v1", params: [firstName, address.pincode] };
}

/** What a queued notice says, as the person stands now; or why it is not sent. */
export async function composeSiteNotice(db: D1Database, kind: SiteNoticeKind, personId: string): Promise<Composed> {
  if (!(await consentGiven(db, personId, "whatsapp_visits"))) return { skip: NO_VISITS_CONSENT };
  const name = await nameOf(db, personId);
  if (name === null) return { skip: "no such person" };
  const firstName = firstNameOf(name);
  if (kind === "consultation_exists") return consultationExists(db, personId, firstName);
  if (kind === "book_in_app") return bookInApp(db, personId, firstName);
  if (kind === "address_not_served") return addressNotServed(db, personId, firstName);
  return addressOnAccount(db, personId, firstName);
}
