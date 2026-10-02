// What the site's booking form tells a number we already know, privately on WhatsApp, since the page tells every
// number the same thing (src/policy/site-booking.ts): that it has a consultation still to happen, that it books in
// the app, or that the visit goes to the address already on its account. Each is composed as it is sent, from how
// the person stands then.

import { shortDate } from "@maneman/web-kit/dates";
import { firstNameOf } from "../lib/names.ts";
import { consentGiven, type MessageKind } from "./messages.ts";
import { currentAddress } from "./profile.ts";
import { bookableTypes, liveVisitOf, type LiveVisit } from "./scheduling.ts";
import { loadSlotSchedule } from "./slot-times.ts";
import { hoursOfWindow, NO_VISITS_CONSENT, type Composed } from "./visit-messages.ts";

export type SiteNoticeKind = Extract<MessageKind, "consultation_exists" | "book_in_app" | "address_on_account">;

const SITE_NOTICE_KINDS: readonly SiteNoticeKind[] = ["consultation_exists", "book_in_app", "address_on_account"];

export const isSiteNoticeKind = (kind: string): kind is SiteNoticeKind =>
  (SITE_NOTICE_KINDS as readonly string[]).includes(kind);

/** A notice to a person about themselves; send its ID to the messaging queue once the statement is written. */
export function siteNotice(
  db: D1Database,
  input: { personId: string; kind: SiteNoticeKind; now: Date },
): { id: string; statement: D1PreparedStatement } {
  const id = crypto.randomUUID();
  const at = input.now.toISOString();
  const statement = db
    .prepare(
      `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_kind, subject_id, state, queued_at)
       VALUES (?1, ?2, ?3, ?4, 'person', ?3, 'queued', ?2)`,
    )
    .bind(id, at, input.personId, input.kind);
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

/** What a queued notice says, as the person stands now; or why it is not sent. */
export async function composeSiteNotice(db: D1Database, kind: SiteNoticeKind, personId: string): Promise<Composed> {
  if (!(await consentGiven(db, personId, "whatsapp_visits"))) return { skip: NO_VISITS_CONSENT };
  const name = await nameOf(db, personId);
  if (name === null) return { skip: "no such person" };
  const firstName = firstNameOf(name);
  if (kind === "consultation_exists") return consultationExists(db, personId, firstName);
  if (kind === "book_in_app") return bookInApp(db, personId, firstName);
  return addressOnAccount(db, personId, firstName);
}
