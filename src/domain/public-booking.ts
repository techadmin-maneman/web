// Booking a free consultation, and joining the waitlist where we do not come yet
// (docs/decisions/0051-booking-from-the-site.md). Two pages do this, and they do
// it the same way: the public site's /book, and a friend's invite at /r/:code.
// The only difference is the invite, which the landing passes always and the site
// only when the visitor's browser remembers one they opened, and the form said
// who is told of the fit beside it (docs/decisions/0089-an-invite-is-not-lost.md).
// A waitlist entry carries no invite for someone who has had, booked or asked for
// a visit: a form anyone can fill in with a number never attributes a client.
//
// Each booking leaves three records:
//
//   the slot,  held for the person and written to FSM from the fsm-sync queue;
//   the lead,  so the CRM funnel sees every booking, as it did in Phase 1;
//   the person, the consent they gave, under the notice they were shown, and
//              the address the visit is at, which is theirs from then on,
//              unless they already had one, which is kept
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
// the number belongs to, never replace the address they have
// (src/policy/site-booking.ts), never let go of a hold made in the app, and book
// no second consultation beside one still to happen. The person, their consent,
// their address and the slot are written in one batch: a slot that has gone
// leaves nothing behind (docs/decisions/0068-a-paid-hold-is-kept.md).
//
// The form may book the consultation and the fit in one visit instead: a first
// fit marked as one, three hours, with nothing paid. The client chooses the
// product with the technician and pays by a link once fitted, so the site still
// takes no money (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md).
// The site's own form may carry a discount code for it, which stands on the
// booking and comes off the product's price at the link; while booking is off,
// it is kept on the request, for ops to enter on the visit they book
// (docs/decisions/0108-discount-codes.md).
//
// The number, the Turnstile token and the day's limits are checked by the
// route's side (src/http/public-form.ts), which this is handed as checkPerson:
// after the pincode and the day, so a form refused for those costs neither.

import type { LossExtent } from "../config/booking.ts";
import { CURRENT_NOTICE, LANDING_NOTICES, type ToldNotice } from "../config/notices.ts";
import { BOOKING_DAYS, HOLD_SECONDS, type BookingWindow } from "../config/scheduling.ts";
import { addDays, indiaDate } from "../lib/india-time.ts";
import type { Logger } from "../log.ts";
import type { SoldTerms } from "../policy/moving-a-visit.ts";
import { ONE_VISIT_TERMS, ONE_VISIT_WINDOWS, type Plan } from "../policy/one-visit.ts";
import type { FsmSyncMessage } from "../queues/fsm-sync.ts";
import type { MessagingMessage } from "../queues/messaging.ts";
import type { Price } from "./price-book.ts";
import { recordConsent, type ConsentRule } from "./consents.ts";
import { bookableService, offeredProducts } from "./services.ts";
import type { ConsentSource } from "../policy/consents.ts";
import { typedAddress, type TypedAddress } from "../policy/site-booking.ts";
import { currentAddress, firstAddressStatement, type Address } from "./profile.ts";
import { checkForOneVisit, codeOnHold, useOnNewHold } from "./discount-code-holds.ts";
import { attribute, hasAskedForAVisit, type Invite, type InviteState, type Via } from "./referrals.ts";
import { bookableTypes, holdSlot, liveVisitOf, type HeldService, type LiveVisit } from "./scheduling.ts";
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
    | "already_booked"
    | "code_not_applicable"
    | "no_product";
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
  readonly checkPerson: (mobile: string, turnstileToken: string, name: string) => Promise<Checked>;
  /** Sends a person's first address on to their FSM contact and CRM lead, as saving it in the app does. */
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
 * The person with this number, new or known, and the consent they gave, on the page they gave it. A person we know
 * keeps their name: a form anyone can fill in with a number never renames the one it belongs to.
 */
function formPerson(
  db: D1Database,
  input: {
    knownId: string | null;
    mobile: string;
    name: string;
    purpose: "whatsapp_visits" | "contact";
    notice: string;
    source: ConsentSource;
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
  const consent = recordConsent(db, {
    person: { id },
    purpose: input.purpose,
    granted: true,
    notice: input.notice,
    source: input.source,
    rule: "always",
    ipHash: input.ipHash,
    givenAt: at,
  });
  return { id, statements: [person, consent.statement] };
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
  input: {
    invite: Invite | null;
    personId: string;
    via: Via;
    pincode: string;
    toldNotice: ToldNotice | null;
    now: Date;
  },
): Promise<{ readonly credits: boolean; readonly invite: InviteState }> {
  if (input.invite === null) return { credits: false, invite: "unknown" };
  const attribution = await attribute(db, { ...input, invite: input.invite });
  if (attribution.outcome === "own_invite" || attribution.outcome === "fitted") {
    return { credits: false, invite: "valid" };
  }
  return { credits: attribution.credits, invite: attribution.lapsed ? "expired" : "valid" };
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
    lossExtent: input.lossExtent,
    proposedVisitDate: input.date,
    attribution: input.attribution,
    requestId,
    now: input.now,
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
 * person asked for, which no slot is held for, and whether it is the consultation
 * and fit in one visit. It leaves the console's task queue when their visit is in
 * FSM (src/domain/tasks.ts). Asked again for the same day and window, the plan
 * asked last stands.
 */
function requestStatement(
  db: D1Database,
  input: {
    personId: string;
    pincode: string;
    date: string;
    window: BookingWindow;
    oneVisit: boolean;
    invite: Invite | null;
    /** The discount code given for the one visit, which ops enter on the visit they book (ADR 0108). */
    discountCode: string | null;
    now: Date;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO consultation_requests (id, person_id, pincode, requested_date, requested_window, referral_code,
         created_at, one_visit, discount_code)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
       ON CONFLICT (person_id, requested_date, requested_window) DO UPDATE SET
         one_visit = excluded.one_visit, discount_code = excluded.discount_code`,
    )
    .bind(
      crypto.randomUUID(),
      input.personId,
      input.pincode,
      input.date,
      input.window,
      input.invite?.code ?? null,
      input.now.toISOString(),
      input.oneVisit ? 1 : 0,
      input.discountCode,
    );
}

/** What the site holds a slot for: the service, what is paid for it now, and the terms it is sold under. */
interface SiteVisit {
  readonly service: HeldService;
  readonly price: Price;
  /** Left out for a consultation, which is sold under the committed terms. */
  readonly terms: SoldTerms | undefined;
}

/** Nothing paid now, at the service's own rate of GST. */
const nothingPaid = (price: Price): Price => ({ amount: 0, amount_ex_gst: 0, gst_percent: price.gst_percent });

/**
 * What the site books on a day: the consultation its kind offers, the standard one while it is
 * (docs/decisions/0085-services-ops-can-edit.md), and only while it is free, since a form with no payment cannot
 * book one the price book charges for; or, for one visit, a first fit held as the first hair system the console
 * offers, for its length, with nothing paid until the client chooses theirs and is fitted
 * (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md). Null when the day offers neither, and what the
 * person asked for waits for ops.
 */
async function siteVisit(db: D1Database, plan: Plan, date: string): Promise<SiteVisit | null> {
  if (plan === "one_visit") {
    const [fit] = await offeredProducts(db, date);
    if (fit === undefined) return null;
    return {
      service: { type: "first_fit", tier: fit.tier, minutes: fit.minutes },
      price: nothingPaid(fit.price),
      terms: ONE_VISIT_TERMS,
    };
  }
  const consultation = await bookableService(db, "consultation", undefined, date);
  if (consultation?.price.amount !== 0) return null;
  return {
    service: { type: "consultation", tier: consultation.tier, minutes: consultation.minutes },
    price: consultation.price,
    terms: undefined,
  };
}

export interface ConsultationRequest {
  readonly name: string;
  readonly mobile: string;
  readonly pincode: string;
  /** Where the consultation is, typed in full; it must be in the pincode, and is written only if the person has none. */
  readonly address: Address;
  readonly date: string;
  readonly window: BookingWindow;
  readonly lossExtent: LossExtent | null;
  readonly turnstileToken: string;
  readonly attribution: Attribution;
  /** The invite the friend arrived with, where there is one. */
  readonly invite: Invite | null;
  /** The line beside the invite that told the friend their referrer hears of the fit; null where the page showed none. */
  readonly toldNotice: ToldNotice | null;
  /**
   * Where the consent on the form is given: the site's /book, or an invite's page
   * (docs/decisions/0094-where-a-consent-was-given.md).
   */
  readonly source: Extract<ConsentSource, "site_booking" | "referral_landing">;
  /** The consultation alone, or the consultation and the first fit in one visit, paid for at the visit. */
  readonly plan: Plan;
  /**
   * A discount code for the one visit, as typed on /book; null for none. It comes off the product's price at the
   * payment link (docs/decisions/0108-discount-codes.md).
   */
  readonly discountCode: string | null;
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
  /** Whether the invite's service visits apply. */
  readonly credits: boolean;
  /** The invite as it stands for this person: expired when theirs lapsed while they waited (src/policy/invites.ts). */
  readonly invite: InviteState;
  /** Whether the address typed in was saved, or the one the person already had is kept and used. */
  readonly address: TypedAddress;
  /** Whether it is the consultation and the first fit in one visit. */
  readonly oneVisit: boolean;
  /** Whether the discount code given stands on the booking, or on the request ops book it from. */
  readonly discountCode: boolean;
}

/**
 * Books the free consultation, or the consultation and fit in one visit: the slot, the lead, and the invite's credits
 * where they apply.
 */
export async function bookConsultation(form: FormRequest, request: ConsultationRequest): Promise<Booked | Refusal> {
  const { db, log, requestId, now } = form;

  const first = addDays(indiaDate(now), 1);
  const pincode = await pincodeOf(db, request.pincode);
  if (pincode?.served !== 1 || request.date < first || request.date > addDays(first, BOOKING_DAYS - 1)) {
    return { ok: false, status: 422, code: "not_bookable" };
  }
  // The first fit's three hours do not fit in the evening (src/policy/one-visit.ts), which the form does not offer.
  const oneVisit = request.plan === "one_visit";
  if (oneVisit && !(ONE_VISIT_WINDOWS as readonly BookingWindow[]).includes(request.window)) {
    return { ok: false, status: 400, code: "invalid_request", fields: ["window"] };
  }
  if (oneVisit && (await offeredProducts(db, request.date)).length === 0) {
    return { ok: false, status: 422, code: "no_product" };
  }
  // The technician goes to the address, so it must be where the pincode said we come.
  if (request.address.pincode !== request.pincode) {
    return { ok: false, status: 400, code: "invalid_request", fields: ["address.pincode"] };
  }
  const checked = await form.checkPerson(request.mobile, request.turnstileToken, request.name);
  if (!checked.ok) return checked;

  const knownId = await personWithMobile(db, checked.mobile);
  const refused = knownId === null ? null : await consultationRefusal(db, knownId);
  if (refused !== null) return refused;
  const code = request.discountCode === null ? null : await oneVisitCode(form, request.discountCode, knownId, oneVisit);
  if (code?.ok === false) return code;
  const person = formPerson(db, {
    knownId,
    mobile: checked.mobile,
    name: request.name,
    purpose: "whatsapp_visits",
    notice: LANDING_NOTICES.consultation,
    source: request.source,
    ipHash: checked.ipHash,
    now,
  });
  const saved = knownId === null ? null : await currentAddress(db, knownId);
  const address = typedAddress({ hasSavedAddress: saved !== null });
  // What stands or falls with the booking: the person, their consent, and the address where it is theirs now.
  const alongside = [
    ...person.statements,
    ...(address === "saved" ? [firstAddressStatement(db, person.id, request.address, now)] : []),
  ];

  // A slot is held and FSM told only while self-serve booking is on and the day offers what was asked for;
  // otherwise booking goes through WhatsApp, and what the person asked for waits for ops.
  const visit = form.selfServeBooking ? await siteVisit(db, request.plan, request.date) : null;
  let holdId: string | null = null;
  if (visit !== null) {
    const hold = await holdSlot(
      db,
      {
        personId: person.id,
        service: visit.service,
        date: request.date,
        window: request.window,
        price: visit.price,
        terms: visit.terms,
        oneVisit,
        pincode: request.pincode,
        from: "site",
        alongside,
        afterHold: (newHold) =>
          code === null ? [] : [useOnNewHold(db, { codeId: code.codeId, personId: person.id, holdId: newHold }, now)],
      },
      now,
      HOLD_SECONDS,
    );
    if (hold === null) return { ok: false, status: 409, code: "taken" };
    holdId = hold.id;
    await form.queues.fsm.send({ hold_id: hold.id, request_id: requestId } satisfies FsmSyncMessage);
  } else {
    const asked = { personId: person.id, pincode: request.pincode, date: request.date, window: request.window };
    const kept = { oneVisit, invite: request.invite, discountCode: code?.code ?? null, now };
    await db.batch([...alongside, requestStatement(db, { ...asked, ...kept })]);
  }
  // The code's use is written with the hold only while the code still has a use left for it, which another booking
  // may have taken a moment before.
  const codeStands = code !== null && (holdId === null || (await codeOnHold(db, holdId)) !== null);
  // Someone we knew may be in FSM and the CRM already, with no address. Someone new is added to both with this
  // one, by the booking and its lead.
  if (knownId !== null && address === "saved") await form.syncContact(person.id);
  const invited = await applyInvite(db, {
    invite: request.invite,
    personId: person.id,
    via: "consultation",
    pincode: request.pincode,
    toldNotice: request.toldNotice,
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
    one_visit: oneVisit,
    discount_code: codeStands,
  });
  return {
    ok: true,
    state,
    date: request.date,
    window: request.window,
    area: pincode.area,
    credits: invited.credits,
    invite: invited.invite,
    address,
    oneVisit,
    discountCode: codeStands,
  };
}

/**
 * The code given on the form, checked: only a consultation and fit in one visit takes one, a consultation costing
 * nothing. One that does not apply refuses the booking, so the client can take it out or put it right; the form
 * says only that it does not apply, and the reason is logged.
 */
async function oneVisitCode(
  form: FormRequest,
  text: string,
  knownId: string | null,
  oneVisit: boolean,
): Promise<{ readonly ok: true; readonly codeId: string; readonly code: string } | Refusal> {
  const notApplicable = { ok: false, status: 422, code: "code_not_applicable", fields: ["discount_code"] } as const;
  if (!oneVisit) {
    form.log.info("discount_code_refused", { reason: "not_covered" });
    return notApplicable;
  }
  const checked = await checkForOneVisit(form.db, text, knownId, form.now);
  if (checked.ok) return checked;
  form.log.info("discount_code_refused", { reason: checked.reason });
  return notApplicable;
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
  /** The line beside the invite that told the friend their referrer hears of the fit; null where the page showed none. */
  readonly toldNotice: ToldNotice | null;
  /**
   * Where the consents on the form are given: the site's waitlist, or an invite's page
   * (docs/decisions/0094-where-a-consent-was-given.md).
   */
  readonly source: Extract<ConsentSource, "site_waitlist" | "referral_landing">;
}

export interface Listed {
  readonly ok: true;
  readonly area: string | null;
  readonly credits: boolean;
  readonly invite: InviteState;
}

/**
 * The invite a waitlist entry carries: none for someone who has had a visit, or booked or asked for one. Anyone can
 * join a list with a number, so the list never attributes a client already in the funnel; ops may attach their invite
 * on the client's page instead.
 */
async function waitlistInvite(db: D1Database, knownId: string | null, invite: Invite | null): Promise<Invite | null> {
  if (invite === null || knownId === null) return invite;
  if (await hasAskedForAVisit(db, knownId)) return null;
  return invite;
}

/**
 * How the launch alert ticked on the form is recorded: as given, for someone new; for someone we know, only while
 * they have never decided it. Anyone can fill in the form with their number, so a decision they made stands.
 */
function launchAlertRule(knownId: string | null): ConsentRule {
  return knownId === null ? "always" : "if_undecided";
}

/** Takes the number for a pincode we do not serve yet, with the launch alert if it was asked for. */
export async function joinTheWaitlist(
  form: FormRequest,
  request: WaitlistRequest,
): Promise<Listed | Refusal<400 | 403 | 422 | 429 | 503>> {
  const { db, now } = form;
  const pincode = await pincodeOf(db, request.pincode);
  if (pincode?.served === 1) return { ok: false, status: 422, code: "not_bookable" };
  const checked = await form.checkPerson(request.mobile, request.turnstileToken, request.name);
  if (!checked.ok) return checked;

  const knownId = await personWithMobile(db, checked.mobile);
  const invite = await waitlistInvite(db, knownId, request.invite);
  const person = formPerson(db, {
    knownId,
    mobile: checked.mobile,
    name: request.name,
    purpose: "contact",
    notice: LANDING_NOTICES.waitlist,
    source: request.source,
    ipHash: checked.ipHash,
    now,
  });
  const personId = person.id;
  const at = now.toISOString();
  const launchAlert = request.launchAlert
    ? [
        recordConsent(db, {
          person: { id: personId },
          purpose: "whatsapp_launches",
          granted: true,
          notice: CURRENT_NOTICE.whatsapp_launches,
          source: request.source,
          rule: launchAlertRule(knownId),
          ipHash: checked.ipHash,
          givenAt: at,
        }).statement,
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
      .bind(crypto.randomUUID(), request.pincode, personId, invite?.code ?? null, at, request.launchAlert ? 1 : 0),
    waitlistConfirmation(db, { personId, pincode: request.pincode, now }),
  ]);
  const confirmation = written.at(-1)?.results[0]?.id;
  if (confirmation !== undefined) await queueMessage(form, confirmation);
  const invited = await applyInvite(db, {
    invite,
    personId,
    via: "waitlist",
    pincode: request.pincode,
    toldNotice: request.toldNotice,
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
    served: false,
    now,
  });
  return { ok: true, area: pincode?.area ?? null, credits: invited.credits, invite: invited.invite };
}
