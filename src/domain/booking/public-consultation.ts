// Booking a free consultation, or the consultation and the fit in one visit, from the site's form or an invite's
// landing (./public-booking.ts says how, and what it leaves).

import { type ToldNotice, CONSULTATION_NOTICES } from "../../config/notices.ts";
import type { LossExtent } from "../../config/booking.ts";
import { HOLD_SECONDS, BOOKING_DAYS, type BookingWindow } from "../../config/scheduling.ts";
import { type Plan, planStartsIn } from "../../policy/one-visit.ts";
import { bookingNeedsProof } from "../../policy/number-proof.ts";
import type { ConsentSource } from "../../policy/consents.ts";
import { addDays, indiaDate } from "../../lib/india-time.ts";
import { type NotBookedFromSite, notBookedFromSite, typedAddress } from "../../policy/site-booking.ts";
import { type Address, currentAddress, firstAddressStatement } from "../clients/profile.ts";
import { testRecordAtCreation } from "../../policy/staging-test-records.ts";
import { pincodeOf, type Pincode } from "../clients/service-area.ts";
import { siteNotice, type SiteNoticeKind } from "../ops/site-notices.ts";
import { type OneVisitCode, useOnNewHold, codeOnHold, checkForOneVisit } from "../money/discount-code-holds.ts";
import type { LeadAttribution } from "../leads/leads.ts";
import type { Invite, InviteState } from "../referrals/referrals.ts";
import { liveVisitOf, bookableTypes, availability } from "./availability.ts";
import { siteVisit, type SiteVisit } from "./site-visit.ts";
import { offeredProducts } from "./services.ts";
import {
  type FormRequest,
  type Refusal,
  queueMessage,
  applyInvite,
  recordLead,
  inviteAsForANewNumber,
} from "./public-booking.ts";
import { holdSlot } from "./hold-slot.ts";
import { personWithMobile, formPerson } from "./form-person.ts";

/** Where a booking is, as the client reads it: the area once ops have named it, its city until then. */
const placeOf = (pincode: Pincode): string => pincode.area ?? pincode.city;

/**
 * Why a person we know books nothing from a form; null when they may book a consultation there. `addressOutsideArea`:
 * the address on their account is in a pincode we do not come to.
 */
async function notBookedFor(
  db: D1Database,
  personId: string,
  addressOutsideArea: boolean,
): Promise<NotBookedFromSite | null> {
  const [consultationToCome, types] = await Promise.all([
    liveVisitOf(db, personId, "consultation"),
    bookableTypes(db, personId),
  ]);
  return notBookedFromSite({
    addressOutsideArea,
    hasConsultationToCome: consultationToCome !== null,
    mayBookConsultation: types.includes("consultation"),
  });
}

/**
 * What ops have to act on while self-serve booking is off: the day and window the
 * person asked for, which no slot is held for, and whether it is the consultation
 * and fit in one visit. It leaves the console's task queue when their visit is
 * booked (src/domain/ops/tasks.ts). Asked again for the same day and window, the plan
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
  readonly attribution: LeadAttribution;
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
  /** The WhatsApp code that proved the number, which the one visit needs; null for none. */
  readonly numberCodeId: string | null;
}

export interface Booked {
  readonly ok: true;
  /**
   * "booked" holds the slot and books it. "requested" is the day and window the
   * person asked for while self-serve booking is off, which ops confirm on
   * WhatsApp (docs/decisions/0060-an-invited-friend-reaches-ops-and-the-crm.md).
   */
  readonly state: "booked" | "requested";
  readonly date: string;
  readonly window: BookingWindow;
  /** The area once ops have named it, its city until then. */
  readonly area: string;
  /** Whether the invite's service visits apply. */
  readonly credits: boolean;
  /** The invite as it stands for this person: expired when theirs lapsed while they waited (src/policy/invites.ts). */
  readonly invite: InviteState;
  /** Whether it is the consultation and the first fit in one visit. */
  readonly oneVisit: boolean;
  /**
   * The discount code given, with what it takes off, while it stands on the booking or on the request ops book it
   * from; null when none was given, or another booking took its last use a moment before.
   */
  readonly discountCode: StandingCode | null;
}

/** A code that stands on a site booking: the code, and what it takes off the hair system's price when they pay. */
export type StandingCode = Pick<OneVisitCode, "code" | "terms">;

/**
 * The request's own checks, before its number's: the pincode served and the day open for booking, a window the plan
 * starts in, a product for a one visit, and the address in the pincode booked at.
 */
async function checkRequest(
  db: D1Database,
  request: ConsultationRequest,
  now: Date,
): Promise<{ ok: true; pincode: Pincode } | Refusal> {
  const first = addDays(indiaDate(now), 1);
  const oneVisit = request.plan === "one_visit";
  const [pincode, products] = await Promise.all([
    pincodeOf(db, request.pincode),
    oneVisit ? offeredProducts(db, request.date) : [],
  ]);
  if (pincode?.served !== 1 || request.date < first || request.date > addDays(first, BOOKING_DAYS - 1)) {
    return { ok: false, status: 422, code: "not_bookable" };
  }
  // The first fit's three hours do not fit in the evening (src/policy/one-visit.ts), which the form does not offer.
  if (!planStartsIn(request.plan, request.window)) {
    return { ok: false, status: 400, code: "invalid_request", fields: ["window"] };
  }
  if (oneVisit && products.length === 0) return { ok: false, status: 422, code: "no_product" };
  // The technician goes to the address, so it must be where the pincode said we come.
  if (request.address.pincode !== request.pincode) {
    return { ok: false, status: 400, code: "invalid_request", fields: ["address.pincode"] };
  }
  return { ok: true, pincode };
}

/**
 * The person a booking is for, and what stands or falls with it: their consent, and the address where it is theirs
 * now, or the WhatsApp that tells its owner one is on the account already.
 */
function bookingPerson(
  form: FormRequest,
  {
    request,
    knownId,
    checked,
    hasSavedAddress,
  }: {
    request: ConsultationRequest;
    knownId: string | null;
    checked: { mobile: string; ipHash: string };
    hasSavedAddress: boolean;
  },
) {
  const { db, now } = form;
  const person = formPerson(db, {
    knownId,
    mobile: checked.mobile,
    name: request.name,
    testRecord: testRecordAtCreation(form.environment, request.name),
    purpose: "whatsapp_visits",
    notice: CONSULTATION_NOTICES[request.source],
    source: request.source,
    ipHash: checked.ipHash,
    now,
  });
  const address = typedAddress({ hasSavedAddress });
  // The page says nothing of an address already on the account; its owner is told on WhatsApp.
  const addressNotice =
    address === "on_account" ? siteNotice(db, { personId: person.id, kind: "address_on_account", now }) : null;
  const alongside = [
    ...person.statements,
    ...(address === "saved" ? [firstAddressStatement(db, person.id, request.address, now)] : []),
    ...(addressNotice === null ? [] : [addressNotice.statement]),
  ];
  return { person, address, addressNotice, alongside };
}

/**
 * A slot held for the visit while the day offers it, with the code's use on it; else the request, which waits for
 * ops. Refused when another booking took the slot first.
 */
async function holdOrRequest(
  form: FormRequest,
  {
    request,
    personId,
    visit,
    pincode,
    alongside,
    code,
  }: {
    request: ConsultationRequest;
    personId: string;
    visit: SiteVisit | null;
    pincode: Pincode;
    alongside: readonly D1PreparedStatement[];
    code: OneVisitCode | null;
  },
): Promise<{ ok: true; holdId: string | null } | Refusal> {
  const { db, now } = form;
  const oneVisit = request.plan === "one_visit";
  if (visit === null) {
    const asked = { personId, pincode: pincode.pincode, date: request.date, window: request.window };
    const kept = { oneVisit, invite: request.invite, discountCode: code?.code ?? null, now };
    await db.batch([...alongside, requestStatement(db, { ...asked, ...kept })]);
    return { ok: true, holdId: null };
  }
  const hold = await holdSlot({
    db,
    input: {
      personId,
      service: visit.service,
      date: request.date,
      window: request.window,
      price: visit.price,
      terms: visit.terms,
      oneVisit,
      pincode: pincode.pincode,
      from: "site",
      alongside,
      afterHold: (newHold) =>
        code === null ? [] : [useOnNewHold(db, { codeId: code.codeId, personId, holdId: newHold }, now)],
    },
    now,
    holdSeconds: HOLD_SECONDS,
  });
  if (hold === null) return { ok: false, status: 409, code: "taken" };
  return { ok: true, holdId: hold.id };
}

/** The invite the booking came with, on record against the consultation it produced. */
function consultationInvite(
  form: FormRequest,
  request: ConsultationRequest,
  booked: { personId: string; pincode: Pincode },
) {
  return applyInvite(form.db, {
    invite: request.invite,
    personId: booked.personId,
    via: "consultation",
    pincode: booked.pincode.pincode,
    toldNotice: request.toldNotice,
    now: form.now,
  });
}

/** The booking's lead, for the CRM: who asked, for which day, at which pincode, and how they came. */
function consultationLead(
  form: FormRequest,
  {
    request,
    personId,
    mobile,
    pincode,
  }: { request: ConsultationRequest; personId: string; mobile: string; pincode: Pincode },
): Promise<string> {
  return recordLead(form, {
    personId,
    name: request.name,
    mobile,
    pincode,
    lossExtent: request.lossExtent,
    date: request.date,
    attribution: request.attribution,
    served: true,
    now: form.now,
  });
}

/**
 * Books the free consultation, or the consultation and fit in one visit: the slot, the lead, and the invite's credits
 * where they apply.
 */
export async function bookConsultation(form: FormRequest, request: ConsultationRequest): Promise<Booked | Refusal> {
  const { db, log, now } = form;
  const oneVisit = request.plan === "one_visit";
  const asked = await checkRequest(db, request, now);
  if (!asked.ok) return asked;
  const { pincode } = asked;
  const checked = await form.checkPerson(request.mobile, request.turnstileToken, request.name);
  if (!checked.ok) return checked;
  // Nothing is looked up or written for a number the plan needs proved until its code was entered.
  if (bookingNeedsProof(request.plan) && !(await form.provedNumber(request.numberCodeId, checked.mobile))) {
    return { ok: false, status: 403, code: "number_not_proved" };
  }

  // A slot is held and booked only while self-serve booking is on and the day offers what was asked for;
  // otherwise booking goes through WhatsApp, and what the person asked for waits for ops.
  const [knownId, visit] = await Promise.all([
    personWithMobile(db, checked.mobile),
    form.selfServeBooking ? siteVisit(db, request.plan, request.date) : null,
  ]);
  const saved = knownId === null ? null : await currentAddress(db, knownId);
  const savedPincode = saved === null ? null : await pincodeOf(db, saved.pincode);
  if (knownId !== null) {
    const addressOutsideArea = saved !== null && savedPincode?.served !== 1;
    const notBooked = await notBookedFor(db, knownId, addressOutsideArea);
    if (notBooked !== null) return answerAsForANewNumber(form, request, pincode, { personId: knownId, notBooked });
  }
  // The visit goes to the address on the account where there is one, which is served, or the person would have been
  // answered above; else to the address typed, in the pincode checked.
  const visitPincode = savedPincode ?? pincode;
  const code = request.discountCode === null ? null : await oneVisitCode(form, request.discountCode, knownId, oneVisit);
  if (code?.ok === false) return code;
  const { person, address, addressNotice, alongside } = bookingPerson(form, {
    request,
    knownId,
    checked,
    hasSavedAddress: saved !== null,
  });
  const placed = await holdOrRequest(form, {
    request,
    personId: person.id,
    visit,
    pincode: visitPincode,
    alongside,
    code,
  });
  if (!placed.ok) return placed;
  const { holdId } = placed;
  // The code's use is written with the hold only while the code still has a use left for it, which another booking
  // may have taken a moment before.
  const codeStands = code !== null && (holdId === null || (await codeOnHold(db, holdId)) !== null);
  const standingCode = codeStands ? { code: code.code, terms: code.terms } : null;
  // Someone we knew may be in Books and the CRM already, with no address. Someone new is added to both with this
  // one, by the booking and its lead.
  if (knownId !== null && address === "saved") await form.syncContact(person.id);
  if (addressNotice !== null) await queueMessage(form, addressNotice.id);
  const invited = await consultationInvite(form, request, { personId: person.id, pincode: visitPincode });
  // Booked once the invite is on record, so the invite names the consultation it produced.
  if (holdId !== null) await form.bookHold(holdId);

  const leadId = await consultationLead(form, {
    request,
    personId: person.id,
    mobile: checked.mobile,
    pincode: visitPincode,
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
    // The place typed, as a new number is told, wherever the visit goes.
    area: placeOf(pincode),
    credits: invited.credits,
    invite: invited.invite,
    oneVisit,
    discountCode: standingCode,
  };
}

/**
 * What a new number would be told, given to a number that books nothing from a form: its code and its window are
 * checked as a new number's would be, nothing is written of the person, and its owner is told why on WhatsApp.
 */
async function answerAsForANewNumber(
  form: FormRequest,
  request: ConsultationRequest,
  pincode: Pincode,
  known: { readonly personId: string; readonly notBooked: NotBookedFromSite },
): Promise<Booked | Refusal> {
  const oneVisit = request.plan === "one_visit";
  const code = request.discountCode === null ? null : await oneVisitCode(form, request.discountCode, null, oneVisit);
  if (code?.ok === false) return code;
  const state = await newNumbersState(form, request);
  if (state === "taken") return { ok: false, status: 409, code: "taken" };

  await tellPrivately(form, known.personId, known.notBooked);
  form.log.info("consultation_not_booked", { reason: known.notBooked, state, one_visit: oneVisit });
  return {
    ok: true,
    state,
    date: request.date,
    window: request.window,
    area: placeOf(pincode),
    ...inviteAsForANewNumber(request.invite, null, form.now),
    oneVisit,
    discountCode: code === null ? null : { code: code.code, terms: code.terms },
  };
}

/**
 * What a new number's booking of this day and window would come to: a slot held, a request for ops, or taken when
 * nobody is free then. It is read for nobody in particular, as for a new number: a number we know hears the same answer,
 * so the form says nothing of whose it is.
 */
async function newNumbersState(
  form: FormRequest,
  request: ConsultationRequest,
): Promise<"booked" | "requested" | "taken"> {
  const visit = form.selfServeBooking ? await siteVisit(form.db, request.plan, request.date) : null;
  if (visit === null) return "requested";
  const length = { minutes: visit.service.minutes };
  const [day] = await availability({
    db: form.db,
    placing: { personId: null },
    visit: length,
    from: request.date,
    days: 1,
    now: form.now,
  });
  const open = day?.windows.find((window) => window.window === request.window)?.open ?? false;
  return open ? "booked" : "taken";
}

/** A notice to a person we know, written and queued on its own. */
async function tellPrivately(form: FormRequest, personId: string, kind: SiteNoticeKind): Promise<void> {
  const notice = siteNotice(form.db, { personId, kind, now: form.now });
  await notice.statement.run();
  await queueMessage(form, notice.id);
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
): Promise<OneVisitCode | Refusal> {
  const notApplicable = { ok: false, status: 422, code: "code_not_applicable", fields: ["discount_code"] } as const;
  if (!oneVisit) {
    form.log.info("discount_code_refused", { reason: "not_covered" });
    return notApplicable;
  }
  const checked = await checkForOneVisit({ db: form.db, text, personId: knownId, now: form.now });
  if (checked.ok) return checked;
  form.log.info("discount_code_refused", { reason: checked.reason });
  return notApplicable;
}
