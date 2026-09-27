// Booking a free consultation, and joining the waitlist where we do not come yet
// (docs/decisions/0051-booking-from-the-site.md). Two pages do this, and they do
// it the same way: the public site's /book, and a friend's invite at /r/:code.
// The only difference is the invite, which the landing passes and the site does not.
//
// Each booking leaves three records:
//
//   the slot,  held for the person and written to FSM from the fsm-sync queue;
//   the lead,  so the CRM funnel sees every booking, as it did in Phase 1;
//   the person, the consent they gave, under the notice they were shown, and
//              the address the visit is at, which is theirs from then on, as
//              though they had saved it in the app
//              (docs/decisions/0081-the-site-takes-the-address.md).
//
// The slot is what the client sees; the lead is what ops sees. A waitlist entry
// leaves the lead and the entry, and no slot or address.
//
// While self-serve booking is off, booking goes through WhatsApp. The slot is
// then a request instead: the day and window the person asked for, waiting for
// ops in the console's task queue
// (docs/decisions/0060-an-invited-friend-reaches-ops-and-the-crm.md). So it is
// too on a day the price book charges for a consultation, which a form with no
// payment cannot book.
//
// These forms need no login, only a number, so they never rename the person
// the number belongs to, never let go of a hold made in the app, and book no
// second consultation beside one still to happen. The address they do replace:
// it is where this visit goes. The person, their consent, their address and the
// slot are written in one batch: a slot that has gone leaves nothing behind
// (docs/decisions/0068-a-paid-hold-is-kept.md).
//
// The number, the Turnstile token and the day's limits are checked by the
// route's side (src/http/public-form.ts), which this is handed as checkPerson:
// after the pincode and the day, so a form refused for those costs neither.

import type { LossExtent } from "../config/booking.ts";
import { CURRENT_NOTICE, LANDING_NOTICES } from "../config/notices.ts";
import { BOOKING_DAYS, HOLD_SECONDS, type BookingWindow } from "../config/scheduling.ts";
import { addDays, indiaDate } from "../lib/india-time.ts";
import type { Logger } from "../log.ts";
import type { FsmSyncMessage } from "../queues/fsm-sync.ts";
import type { MessagingMessage } from "../queues/messaging.ts";
import { priceOf } from "./price-book.ts";
import { addressStatements, type Address } from "./profile.ts";
import { attribute, type Invite, type InviteState } from "./referrals.ts";
import { bookableTypes, holdSlot, liveVisitOf, type LiveVisit } from "./scheduling.ts";
import { saveBookingLead, type Attribution } from "./leads.ts";
import { waitlistConfirmation } from "./waitlist.ts";

/** A pincode we know, and whether a technician works there. */
export interface Pincode {
  readonly pincode: string;
  readonly area: string;
  readonly city: string;
  readonly served: number;
}

export function pincodeOf(db: D1Database, pin: string): Promise<Pincode | null> {
  return db
    .prepare("SELECT pincode, area, city, served FROM serviceable_pincodes WHERE pincode = ?1")
    .bind(pin)
    .first<Pincode>();
}

/**
 * Why a submission was refused, in the codes the routes answer with. Each route
 * declares which statuses it can answer, so the type says which ones its caller
 * may see: only a booking can be too late for a window.
 */
export interface Refusal<Status extends number = 400 | 403 | 409 | 422 | 429 | 503> {
  readonly ok: false;
  readonly status: Status;
  readonly code:
    | "invalid_request"
    | "turnstile_failed"
    | "rate_limited"
    | "unavailable"
    | "taken"
    | "not_bookable"
    | "already_booked";
  /** For already_booked: the consultation the number already has. */
  readonly booked?: LiveVisit;
  /** For invalid_request: the field refused, where the request was well formed and did not add up. */
  readonly fields?: readonly string[];
}

/** The person a form is from, checked: their number as E.164 and their address's salted hash; or why not. */
export type Checked =
  { readonly ok: true; readonly mobile: string; readonly ipHash: string } | Refusal<400 | 403 | 429 | 503>;

/** What booking from a form needs of the request it arrived in. */
export interface FormRequest {
  readonly db: D1Database;
  readonly queues: { readonly crm: Queue; readonly fsm: Queue; readonly messages: Queue };
  readonly log: Logger;
  readonly requestId: string;
  readonly now: Date;
  /** Clients book, and the slot is held, only while self-serve booking is on (ADR 0045). */
  readonly selfServeBooking: boolean;
  /** The number, the Turnstile token and the day's limits per number and address, the same for both pages. */
  readonly checkPerson: (mobile: string, turnstileToken: string) => Promise<Checked>;
  /** Sends a person's new address on to their FSM contact and CRM lead, as an edit in the app does. */
  readonly syncContact: (personId: string) => Promise<void>;
}

/** The person a form is from, and the writes that record them and the consent they gave on the page. */
interface FormPerson {
  readonly id: string;
  /** Run in one batch with what the form books, so a refusal leaves nothing behind. */
  readonly statements: D1PreparedStatement[];
}

async function personWithMobile(db: D1Database, mobile: string): Promise<string | null> {
  const row = await db.prepare("SELECT id FROM people WHERE mobile_e164 = ?1").bind(mobile).first<{ id: string }>();
  return row?.id ?? null;
}

/**
 * The person with this number, new or known, and the consent they gave. A person we know keeps their name: a
 * form anyone can fill in with a number never renames the one it belongs to.
 */
function formPerson(
  db: D1Database,
  input: {
    knownId: string | null;
    mobile: string;
    name: string;
    purpose: "whatsapp_visits" | "contact";
    notice: string;
    ipHash: string;
    now: Date;
  },
): FormPerson {
  const at = input.now.toISOString();
  const id = input.knownId ?? crypto.randomUUID();
  const person =
    input.knownId === null
      ? db
          .prepare("INSERT INTO people (id, created_at, mobile_e164, name, contactable) VALUES (?1, ?2, ?3, ?4, 1)")
          .bind(id, at, input.mobile, input.name)
      : db.prepare("UPDATE people SET contactable = 1 WHERE id = ?1").bind(id);
  const consent = db
    .prepare(
      `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at, ip_hash)
       VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6)`,
    )
    .bind(crypto.randomUUID(), id, input.purpose, input.notice, at, input.ipHash);
  return { id, statements: [person, consent] };
}

/**
 * Why a person we know may not book a consultation from a form: they have one still to happen, or they are
 * past consultations (consulted, or fitted), which the app books instead.
 */
async function consultationRefusal(db: D1Database, personId: string): Promise<Refusal | null> {
  const booked = await liveVisitOf(db, personId, "consultation");
  if (booked !== null) return { ok: false, status: 409, code: "already_booked", booked };
  if (!(await bookableTypes(db, personId)).includes("consultation")) {
    return { ok: false, status: 422, code: "not_bookable" };
  }
  return null;
}

/** Attributes the person to the invite they came with, after what the form booked stands. */
async function applyInvite(
  db: D1Database,
  input: { invite: Invite | null; personId: string; via: "consultation" | "waitlist"; pincode: string; now: Date },
): Promise<{ readonly credits: boolean; readonly invite: InviteState }> {
  if (input.invite === null) return { credits: false, invite: "unknown" };
  const attributed = await attribute(db, { ...input, invite: input.invite });
  return { credits: attributed.credits, invite: attributed.lapsed ? "expired" : "valid" };
}

/** The city a lead may name: the pincode's, where we have it as a city of ours. */
async function leadCity(db: D1Database, city: string): Promise<string | null> {
  const row = await db.prepare("SELECT name FROM cities WHERE name = ?1").bind(city).first<{ name: string }>();
  return row?.name ?? null;
}

/**
 * The lead behind a booking or a waitlist entry, which is what reaches the CRM.
 * A Phase 2 form asks for neither the loss extent nor a rough window, so both may
 * be absent; the date it does have is the one the person booked.
 */
async function recordLead(
  form: FormRequest,
  input: {
    personId: string;
    name: string;
    mobile: string;
    pincode: Pincode | null;
    lossExtent: LossExtent | null;
    date: string | null;
    attribution: Attribution;
    ipHash: string;
    served: boolean;
    now: Date;
  },
): Promise<string> {
  const { db, log, requestId } = form;
  const leadId = crypto.randomUUID();
  await saveBookingLead(db, {
    leadId,
    newPersonId: input.personId,
    name: input.name,
    mobileE164: input.mobile,
    city: input.pincode === null ? null : await leadCity(db, input.pincode.city),
    source: input.served ? "form" : "waitlist",
    window: null,
    lossExtent: input.lossExtent,
    proposedVisitDate: input.date,
    attribution: input.attribution,
    ipHash: input.ipHash,
    requestId,
    now: input.now,
    // The consent was recorded with the notice the page showed, before this.
    recordConsent: false,
  });
  try {
    await form.queues.crm.send({ lead_id: leadId, request_id: requestId });
  } catch (error) {
    // The lead is safe in D1; the sweeper enqueues anything left pending.
    log.warn("crm_enqueue_failed", { lead_id: leadId, error });
  }
  return leadId;
}

/** Sends a message written with the form's batch to the messaging queue. One the queue drops, the sweeper sends. */
async function queueMessage(form: FormRequest, messageId: string): Promise<void> {
  try {
    await form.queues.messages.send({ message_id: messageId, request_id: form.requestId } satisfies MessagingMessage);
  } catch (error) {
    form.log.warn("message_enqueue_failed", { outbound_message_id: messageId, error });
  }
}

/**
 * What ops have to act on while self-serve booking is off: the day and window the
 * person asked for, which no slot is held for. It leaves the console's task queue
 * when their consultation is in FSM (src/domain/tasks.ts).
 */
function requestStatement(
  db: D1Database,
  input: {
    personId: string;
    pincode: string;
    date: string;
    window: BookingWindow;
    invite: Invite | null;
    now: Date;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO consultation_requests (id, person_id, pincode, requested_date, requested_window, referral_code,
         created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT (person_id, requested_date, requested_window) DO NOTHING`,
    )
    .bind(
      crypto.randomUUID(),
      input.personId,
      input.pincode,
      input.date,
      input.window,
      input.invite?.code ?? null,
      input.now.toISOString(),
    );
}

export interface ConsultationRequest {
  readonly name: string;
  readonly mobile: string;
  readonly pincode: string;
  /** Where the consultation is, typed in full; it must be in the pincode. */
  readonly address: Address;
  readonly date: string;
  readonly window: BookingWindow;
  readonly lossExtent: LossExtent | null;
  readonly turnstileToken: string;
  readonly attribution: Attribution;
  /** The invite the friend arrived with, where there is one. */
  readonly invite: Invite | null;
}

export interface Booked {
  readonly ok: true;
  /**
   * "booked" holds the slot and tells FSM. "requested" is the day and window the
   * person asked for while self-serve booking is off, which ops confirm on
   * WhatsApp (docs/decisions/0060-an-invited-friend-reaches-ops-and-the-crm.md).
   */
  readonly state: "booked" | "requested";
  readonly date: string;
  readonly window: BookingWindow;
  readonly area: string;
  /** Whether the invite's three service visits apply. */
  readonly credits: boolean;
  /** The invite as it stands for this person: expired when theirs lapsed while they waited (src/policy/invites.ts). */
  readonly invite: InviteState;
}

/** Books the free consultation: the slot, the lead, and the invite's credits where they apply. */
export async function bookConsultation(form: FormRequest, request: ConsultationRequest): Promise<Booked | Refusal> {
  const { db, log, requestId, now } = form;

  const first = addDays(indiaDate(now), 1);
  const pincode = await pincodeOf(db, request.pincode);
  if (pincode?.served !== 1 || request.date < first || request.date > addDays(first, BOOKING_DAYS - 1)) {
    return { ok: false, status: 422, code: "invalid_request" };
  }
  // The technician goes to the address, so it must be where the pincode said we come.
  if (request.address.pincode !== request.pincode) {
    return { ok: false, status: 422, code: "invalid_request", fields: ["address.pincode"] };
  }
  const checked = await form.checkPerson(request.mobile, request.turnstileToken);
  if (!checked.ok) return checked;

  const knownId = await personWithMobile(db, checked.mobile);
  const refused = knownId === null ? null : await consultationRefusal(db, knownId);
  if (refused !== null) return refused;
  const person = formPerson(db, {
    knownId,
    mobile: checked.mobile,
    name: request.name,
    purpose: "whatsapp_visits",
    notice: LANDING_NOTICES.consultation,
    ipHash: checked.ipHash,
    now,
  });
  // Typed, never chosen from Google's suggestions, so the address has no pin.
  const alongside = [...person.statements, ...addressStatements(db, person.id, request.address, null, now)];

  // A slot is held and FSM told only while self-serve booking is on and the consultation is free that day;
  // otherwise booking goes through WhatsApp, and what the person asked for waits for ops.
  const price = await priceOf(db, "consultation", request.date);
  let holdId: string | null = null;
  if (form.selfServeBooking && price?.amount === 0) {
    const hold = await holdSlot(
      db,
      {
        personId: person.id,
        type: "consultation",
        date: request.date,
        window: request.window,
        price,
        pincode: request.pincode,
        from: "site",
        alongside,
      },
      now,
      HOLD_SECONDS,
    );
    if (hold === null) return { ok: false, status: 409, code: "taken" };
    holdId = hold.id;
    await form.queues.fsm.send({ hold_id: hold.id, request_id: requestId } satisfies FsmSyncMessage);
  } else {
    const asked = { personId: person.id, pincode: request.pincode, date: request.date, window: request.window };
    await db.batch([...alongside, requestStatement(db, { ...asked, invite: request.invite, now })]);
  }
  // Someone we knew may be in FSM and the CRM already, with an older address or none. Someone new is added to
  // both with this one, by the booking and its lead.
  if (knownId !== null) await form.syncContact(person.id);
  const invited = await applyInvite(db, {
    invite: request.invite,
    personId: person.id,
    via: "consultation",
    pincode: request.pincode,
    now,
  });

  const leadId = await recordLead(form, {
    personId: person.id,
    name: request.name,
    mobile: checked.mobile,
    pincode,
    lossExtent: request.lossExtent,
    date: request.date,
    attribution: request.attribution,
    ipHash: checked.ipHash,
    served: true,
    now,
  });
  const state = holdId === null ? ("requested" as const) : ("booked" as const);
  log.info("consultation_booked", {
    state,
    hold_id: holdId,
    lead_id: leadId,
    invited: request.invite !== null,
    credits: invited.credits,
  });
  return {
    ok: true,
    state,
    date: request.date,
    window: request.window,
    area: pincode.area,
    credits: invited.credits,
    invite: invited.invite,
  };
}

export interface WaitlistRequest {
  readonly name: string;
  readonly mobile: string;
  readonly pincode: string;
  readonly lossExtent: LossExtent | null;
  readonly launchAlert: boolean;
  readonly turnstileToken: string;
  readonly attribution: Attribution;
  readonly invite: Invite | null;
}

export interface Listed {
  readonly ok: true;
  readonly area: string | null;
  readonly credits: boolean;
  readonly invite: InviteState;
}

/** Takes the number for a pincode we do not serve yet, with the launch alert if it was asked for. */
export async function joinTheWaitlist(
  form: FormRequest,
  request: WaitlistRequest,
): Promise<Listed | Refusal<400 | 403 | 422 | 429 | 503>> {
  const { db, now } = form;
  const pincode = await pincodeOf(db, request.pincode);
  if (pincode?.served === 1) return { ok: false, status: 422, code: "invalid_request" };
  const checked = await form.checkPerson(request.mobile, request.turnstileToken);
  if (!checked.ok) return checked;

  const person = formPerson(db, {
    knownId: await personWithMobile(db, checked.mobile),
    mobile: checked.mobile,
    name: request.name,
    purpose: "contact",
    notice: LANDING_NOTICES.waitlist,
    ipHash: checked.ipHash,
    now,
  });
  const personId = person.id;
  const at = now.toISOString();
  const launchAlert = request.launchAlert
    ? [
        db
          .prepare(
            `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at, ip_hash)
             VALUES (?1, ?2, 'whatsapp_launches', ?3, 1, ?4, ?5)`,
          )
          .bind(crypto.randomUUID(), personId, CURRENT_NOTICE.whatsapp_launches, at, checked.ipHash),
      ]
    : [];
  const written = await db.batch<{ id: string }>([
    ...person.statements,
    ...launchAlert,
    db
      .prepare(
        `INSERT INTO waitlist_entries (id, pincode, person_id, referral_code, contact_consent_at, launch_alert,
           created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?5)
         ON CONFLICT (pincode, person_id) DO UPDATE SET launch_alert = MAX(launch_alert, excluded.launch_alert)`,
      )
      .bind(
        crypto.randomUUID(),
        request.pincode,
        personId,
        request.invite?.code ?? null,
        at,
        request.launchAlert ? 1 : 0,
      ),
    waitlistConfirmation(db, { personId, pincode: request.pincode, now }),
  ]);
  const confirmation = written.at(-1)?.results[0]?.id;
  if (confirmation !== undefined) await queueMessage(form, confirmation);
  const invited = await applyInvite(db, {
    invite: request.invite,
    personId,
    via: "waitlist",
    pincode: request.pincode,
    now,
  });

  await recordLead(form, {
    personId,
    name: request.name,
    mobile: checked.mobile,
    pincode,
    lossExtent: request.lossExtent,
    date: null,
    attribution: request.attribution,
    ipHash: checked.ipHash,
    served: false,
    now,
  });
  return { ok: true, area: pincode?.area ?? null, credits: invited.credits, invite: invited.invite };
}
