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
//   the slot,  held for the person and booked as their visit;
//   the lead,  so the CRM funnel sees every booking;
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
// the number belongs to, never replace the address they have, and never let go
// of a hold made in the app. They give every number the same answer
// (src/policy/site-booking.ts): a number with a consultation still to happen, or
// past consultations, books nothing, and its owner is told why on WhatsApp
// (src/domain/booking/site-notices.ts). A visit goes to the address already on the
// account, so that address's pincode is the one checked and booked; where we do
// not come to it, nothing is booked, and its owner is told so on WhatsApp too. A
// number joining a waitlist is told of its invite as a new number would be. The
// person, their consent, their address and the slot are written in one batch: a
// slot that has gone leaves nothing behind (docs/decisions/0068-a-paid-hold-is-kept.md).
//
// The form may book the consultation and the fit in one visit instead, for a
// number proved with its WhatsApp code (src/policy/number-proof.ts): a first
// fit marked as one, three hours, with nothing paid. The client chooses the
// product with the technician and pays by a link once fitted, so the site still
// takes no money (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md).
// The site's own form may carry a discount code for it, which stands on the
// booking and comes off the product's price at the link; while booking is off,
// it is kept on the request, for ops to enter on the visit they book, as it
// stood when typed (src/domain/money/requested-codes.ts).
//
// The number, the Turnstile token and the day's limits are checked by the
// route's side (src/http/public-form.ts), which this is handed as checkPerson:
// after the pincode and the day, so a form refused for those costs neither.
//
// What both forms share is here: the request, the invite, the lead and the message. Booking is
// ./public-consultation.ts, joining the waitlist ./public-waitlist.ts, and the visit a day offers ./site-visit.ts.

import type { LossExtent } from "../../config/booking.ts";
import type { ToldNotice } from "../../config/notices.ts";
import type { Logger } from "../../log.ts";
import { enqueue, notifyMessage } from "../platform/enqueue.ts";
import { testRecordAtCreation } from "../../policy/staging-test-records.ts";
import type { EnvironmentName } from "../../config/environments.ts";
import { attribute, type InviteState, type Via } from "../referrals/referrals.ts";
import { attributeToPartner, isPartnerInvite, type AnyInvite } from "../referrals/channels.ts";
import { saveBookingLead, type LeadAttribution } from "../leads/leads.ts";
import { type Pincode } from "../clients/service-area.ts";
import { inviteLapsed } from "../../policy/invites.ts";
import type { Address, AddressPin } from "../clients/profile.ts";
import type { Refusal as DomainRefusal } from "../../lib/refusal.ts";

/** The codes a submission is refused with; each carries its own status (src/http/errors.ts, ERROR_STATUS). */
type RefusalCode =
  | "invalid_request"
  | "turnstile_failed"
  | "rate_limited"
  | "unavailable"
  | "taken"
  | "not_bookable"
  | "code_not_applicable"
  | "no_product"
  | "number_not_proved";

/** What any form can be refused for before it is read: the request, Turnstile, a limit, or the database. */
export type FormRefusalCode = "invalid_request" | "turnstile_failed" | "rate_limited" | "unavailable";

/**
 * Why a submission was refused, in the codes the routes answer with. Each route declares the statuses those codes
 * carry, so the type says which ones its caller may see: only a booking can be too late for a window.
 */
export type Refusal<Code extends RefusalCode = RefusalCode> = DomainRefusal<Code>;

/** The person a form is from, checked: their number as E.164 and their address's salted hash; or why not. */
export type Checked =
  { readonly ok: true; readonly mobile: string; readonly ipHash: string } | Refusal<FormRefusalCode>;

/** What booking from a form needs of the request it arrived in. */
export interface FormRequest {
  readonly db: D1Database;
  readonly queues: { readonly crm: Queue; readonly messages: Queue };
  readonly log: Logger;
  readonly requestId: string;
  readonly now: Date;
  /** Where the form is answered: a person made on staging with a test name is a test record. */
  readonly environment: EnvironmentName;
  /** Clients book, and the slot is held, only while consultations are self-serve (ADR 0045). */
  readonly selfServeBooking: boolean;
  /** The number, the Turnstile token and the day's limits per number and address, the same for both pages. */
  readonly checkPerson: (mobile: string, turnstileToken: string, name: string) => Promise<Checked>;
  /** Whether the WhatsApp code `codeId` proved this number (src/policy/number-proof.ts). */
  readonly provedNumber: (codeId: string | null, mobileE164: string) => Promise<boolean>;
  /** The address's coordinate, where Google places it to the building, or none (src/http/address-save.ts). */
  readonly pinOf: (address: Address, session: string | null) => Promise<AddressPin | null>;
  /** Sends a person's first address on to their Books customer and CRM lead, as saving it in the app does. */
  readonly syncContact: (personId: string) => Promise<void>;
  /** Books the free hold the form made (src/http/book-hold.ts). It never throws, so the lead is recorded whatever comes of it. */
  readonly bookHold: (holdId: string) => Promise<void>;
}

/** Attributes the person to the invite they came with, a client's or a partner's, after what the form booked stands. */
export async function applyInvite(
  db: D1Database,
  input: {
    invite: AnyInvite | null;
    personId: string;
    via: Via;
    pincode: string;
    toldNotice: ToldNotice | null;
    now: Date;
  },
): Promise<{ readonly credits: boolean; readonly invite: InviteState }> {
  if (input.invite === null) return { credits: false, invite: "unknown" };
  if (isPartnerInvite(input.invite)) {
    const partner = await attributeToPartner(db, { ...input, invite: input.invite });
    if (partner.outcome === "fitted") return { credits: false, invite: "valid" };
    return { credits: partner.credits, invite: partner.lapsed ? "expired" : "valid" };
  }
  const attribution = await attribute(db, { ...input, invite: input.invite });
  if (attribution.outcome === "own_invite" || attribution.outcome === "fitted") {
    return { credits: false, invite: "valid" };
  }
  return { credits: attribution.credits, invite: attribution.lapsed ? "expired" : "valid" };
}

/**
 * What a new number is told of the invite it came with: its credits apply, unless it was held on the waitlist of an
 * area that launched more than 12 months ago. A number we know that books nothing, or joins a waitlist, is told the
 * same, whatever stands for it, so the page never says that a number is known.
 */
export function inviteAsForANewNumber(
  invite: AnyInvite | null,
  waitlistLaunchedAt: string | null,
  now: Date,
): { readonly credits: boolean; readonly invite: InviteState } {
  if (invite === null) return { credits: false, invite: "unknown" };
  if (waitlistLaunchedAt !== null && inviteLapsed(new Date(waitlistLaunchedAt), now)) {
    return { credits: false, invite: "expired" };
  }
  // A partner may give the friend no visits of their own.
  return { credits: !isPartnerInvite(invite) || invite.friendVisits > 0, invite: "valid" };
}

/** The city a lead may name: the pincode's, where we have it as a city of ours. */
async function leadCity(db: D1Database, city: string): Promise<string | null> {
  const row = await db.prepare("SELECT name FROM cities WHERE name = ?1").bind(city).first<{ name: string }>();
  return row?.name ?? null;
}

/**
 * The lead behind a booking or a waitlist entry, which is what reaches the CRM.
 * Today's forms ask for neither the loss extent nor a rough window, so both may
 * be absent; the date it does have is the one the person booked.
 */
export async function recordLead(
  form: FormRequest,
  input: {
    personId: string;
    name: string;
    mobile: string;
    pincode: Pincode | null;
    lossExtent: LossExtent | null;
    date: string | null;
    attribution: LeadAttribution;
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
    testRecord: testRecordAtCreation(form.environment, input.name),
    mobileE164: input.mobile,
    city: input.pincode === null ? null : await leadCity(db, input.pincode.city),
    source: input.served ? "form" : "waitlist",
    lossExtent: input.lossExtent,
    proposedVisitDate: input.date,
    attribution: input.attribution,
    requestId,
    now: input.now,
  });
  await enqueue(form.queues.crm, { lead_id: leadId, request_id: requestId }, { log, ifLost: "sweeper" });
  return leadId;
}

/** Sends a message written with the form's batch to the messaging queue. One the queue drops, the sweeper sends. */
export async function queueMessage(form: FormRequest, messageId: string): Promise<void> {
  await notifyMessage(form.queues.messages, { id: messageId, requestId: form.requestId }, form.log);
}
