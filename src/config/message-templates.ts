// The texts of the WhatsApp messages we send, by template name. RESULT_TEMPLATE
// picks the try-on result's. Evolution has no Meta-approved templates, so the
// text lives here; an official BSP would hold its own copy.
//
// PLACEHOLDER COPY, pending the owner's wording. The second sentence is the
// design's own ("a simulation, not a photograph of a result").
//
// {{1}}, {{2}}, … are the params, in order, as in WhatsApp templates.

import { MESSAGE_KINDS, type MessageKind } from "../domain/messages.ts";

const TEMPLATES: Readonly<Record<string, string>> = {
  tryon_result_v1:
    "Hello {{1}}, here is your Mane Man try-on. What you see is a simulation, not a photograph of a result.",
  // The client app's login code (docs/decisions/0030-one-time-codes.md). PLACEHOLDER COPY, pending the owner's wording.
  login_code_v1: "{{1}} is your Mane Man code. It works for ten minutes. We will never ask you for it.",
  // About a client's visits (docs/decisions/0047-visit-messages.md), sent only with the client's consent to
  // WhatsApp about visits. PLACEHOLDER COPY, pending the owner's wording (docs/open-points.md, item 40). Every one
  // takes the same params, and uses those it needs: {{1}} the client's first name, {{2}} the visit ("service
  // visit"), {{3}} its day ("Thu 24 Sep"), {{4}} its window ("12 to 4 pm"), {{5}} the technician's first name,
  // {{6}} the amount ("Rs. 2,000"), {{7}} the payment's reference, {{8}} where a refund goes ("UPI"), {{9}} how many
  // minutes the technician waited, for a no-show, and {{10}} what goes back of a no-show's charge.
  consultation_booked_v1: "Hello {{1}}, your free consultation is booked for {{3}}, {{4}}. We will see you then.",
  // The consultation and fit in one visit, booked from the site with nothing paid
  // (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md).
  one_visit_booked_v1:
    "Hello {{1}}, your consultation and fit is booked for {{3}}, {{4}}. You pay only once you are fitted.",
  visit_booked_v1:
    "Hello {{1}}, your {{2}} is booked for {{3}}, {{4}}, with {{5}}. Paid {{6}}, reference {{7}}. The receipt is in the app.",
  visit_booked_credit_v1:
    "Hello {{1}}, your {{2}} is booked for {{3}}, {{4}}, with {{5}}. One of your visit credits covers it.",
  // A visit a discount code made free (docs/decisions/0108-discount-codes.md): booked with nothing to pay.
  visit_booked_code_v1:
    "Hello {{1}}, your {{2}} is booked for {{3}}, {{4}}, with {{5}}. Your discount code covers it, so there is nothing to pay.",
  // A consultation and fit in one visit a discount code made free, once the client is fitted.
  visit_fitted_code_v1:
    "Hello {{1}}, you are fitted. Your discount code covers your hair system, so there is nothing to pay.",
  visit_reminder_v1: "Hello {{1}}, a reminder that your {{2}} is tomorrow, {{3}}, {{4}}, with {{5}}.",
  visit_moved_v1: "Hello {{1}}, your {{2}} is now on {{3}}, {{4}}, with {{5}}.",
  // At the technician's check-in (docs/decisions/0074-hand-offs-and-messages.md), the no-show's evidence.
  technician_arrived_v1: "Hello {{1}}, {{5}} has arrived for your {{2}}.",
  // Ops' ruling on a visit the client was not home for (docs/decisions/0074-hand-offs-and-messages.md), with {{9}}
  // the minutes the technician waited. A charge costs what the booking was sold to cost a no-show, set apart from a
  // late cancel's (docs/decisions/0096-a-no-shows-charge-and-its-dispute.md), so each text says what it kept, {{6}},
  // and what goes back, {{10}}, and that a client who was home can dispute it in the app; a charge of nothing reads
  // as a waiver that gives both back. A waiver refunds the payment and returns the credit, as the owner ruled on 27
  // September 2026 (src/policy/no-show.ts, WAIVER_GIVES_BACK), and the two texts that ask the client to message us
  // stand only where ops set a waiver to keep them. None names the notice, which ops set
  // (docs/decisions/0088-every-policy-in-the-console.md). Booking again is in the app, never a message to us: the
  // owner ruled on 27 September 2026 that "Message us" is for problems only (ADR 0025, item 70). Never ops' reason,
  // which stays with the ruling.
  no_show_missed_v1:
    "Hello {{1}}, we came for your {{2}} on {{3}} and waited {{9}} minutes, but nobody was home. You can book again in the Mane Man app.",
  no_show_charged_paid_v1:
    "Hello {{1}}, we came for your {{2}} on {{3}} and waited {{9}} minutes, but nobody was home. The {{6}} you paid for it is kept as the no-show charge. If you were home, you can dispute it in the Mane Man app.",
  no_show_charged_fee_v1:
    "Hello {{1}}, we came for your {{2}} on {{3}} and waited {{9}} minutes, but nobody was home. {{6}} of what you paid is kept as the no-show charge, and {{10}} is on its way back to your {{8}}, in 5 to 7 working days. If you were home, you can dispute the charge in the Mane Man app.",
  no_show_charged_credit_v1:
    "Hello {{1}}, we came for your {{2}} on {{3}} and waited {{9}} minutes, but nobody was home. The visit credit it used is spent as the no-show charge. If you were home, you can dispute it in the Mane Man app.",
  no_show_waived_v1:
    "Hello {{1}}, we came for your {{2}} on {{3}} and waited {{9}} minutes, but nobody was home. We are not charging you for it. You can book again in the Mane Man app.",
  no_show_waived_paid_v1:
    "Hello {{1}}, we came for your {{2}} on {{3}} and waited {{9}} minutes, but nobody was home. We are not charging you for it. Message us about the {{6}} you paid for it.",
  no_show_waived_credit_v1:
    "Hello {{1}}, we came for your {{2}} on {{3}} and waited {{9}} minutes, but nobody was home. We are not charging you for it. Message us about the visit credit it used.",
  no_show_waived_refund_v1:
    "Hello {{1}}, we came for your {{2}} on {{3}} and waited {{9}} minutes, but nobody was home. We are not charging you for it: {{6}} is on its way back to your {{8}}, in 5 to 7 working days.",
  no_show_waived_credit_back_v1:
    "Hello {{1}}, we came for your {{2}} on {{3}} and waited {{9}} minutes, but nobody was home. We are not charging you for it, and your visit credit is back.",
  // A credit given back to a grant that has since expired or been clawed back does not come back; ops are told.
  no_show_waived_credit_gone_v1:
    "Hello {{1}}, we came for your {{2}} on {{3}} and waited {{9}} minutes, but nobody was home. We are not charging you for it, but the visit credit it used is no longer valid, so it cannot come back.",
  // Ops' ruling on a client's dispute of a no-show's charge (docs/decisions/0096-a-no-shows-charge-and-its-dispute.md):
  // refunded, {{6}} going back to {{8}} or the credit back (or not, where its grant has gone), or upheld. Never ops'
  // reason, which stays with the ruling; one who wants to know why may ask, a problem being what "Message us" is for
  // (ADR 0025, item 70).
  no_show_dispute_refunded_v1:
    "Hello {{1}}, we have looked at your dispute of the no-show charge for your {{2}} on {{3}}, and we are refunding it: {{6}} is on its way back to your {{8}}, in 5 to 7 working days.",
  no_show_dispute_credit_back_v1:
    "Hello {{1}}, we have looked at your dispute of the no-show charge for your {{2}} on {{3}}, and we are refunding it: your visit credit is back.",
  no_show_dispute_credit_gone_v1:
    "Hello {{1}}, we have looked at your dispute of the no-show charge for your {{2}} on {{3}}, and we agree the charge should not stand, but the visit credit it used is no longer valid, so it cannot come back.",
  no_show_dispute_upheld_v1:
    "Hello {{1}}, we have looked at your dispute of the no-show charge for your {{2}} on {{3}}. The charge stands. Message us if you would like to know why.",
  // The next visit falls due in a few days and nothing is booked (docs/decisions/0086-the-next-visit-is-offered.md),
  // sent once a last visit, only with the client's consent to WhatsApp about their visits. PLACEHOLDER COPY, pending
  // the owner's wording: {{1}} the client's first name, {{2}} the visit ("service visit", or "replacement" where the
  // piece falls due first), {{3}} the day it falls due ("Tue 27 Oct").
  next_visit_due_v1: "Hello {{1}}, your next {{2}} is due on {{3}}. You can book it in the Mane Man app.",
  visit_cancelled_v1: "Hello {{1}}, your {{2}} on {{3}} is cancelled.",
  visit_cancelled_credit_v1: "Hello {{1}}, your {{2}} on {{3}} is cancelled. Your visit credit is back.",
  // A credit-paid visit cancelled inside the notice keeps its credit, as the cancel sheet warned; one cancelled in time
  // whose grant has since expired or been withdrawn cannot take it back (docs/decisions/0068-a-paid-hold-is-kept.md).
  visit_cancelled_credit_lost_v1:
    "Hello {{1}}, your {{2}} on {{3}} is cancelled. It was too close to the visit, so the visit credit it used is gone.",
  visit_cancelled_credit_gone_v1:
    "Hello {{1}}, your {{2}} on {{3}} is cancelled. The visit credit it used has expired, so it cannot come back.",
  // To a person who joined a pincode's waitlist, sent with their consent to be contacted about the request
  // (docs/decisions/0074-hand-offs-and-messages.md). PLACEHOLDER COPY: {{1}} their first name, {{2}} the area. Only
  // one who asked to be told of the launch, and still consents to it, is promised word of it.
  waitlist_listed_v1: "Hello {{1}}, you are on our list for {{2}}. We do not come there yet.",
  waitlist_listed_alert_v1:
    "Hello {{1}}, you are on our list for {{2}}. We will message you on WhatsApp when we come there.",
  // When a pincode launches, to those on its waitlist who asked to be told (docs/decisions/0048-referrals.md).
  // PLACEHOLDER COPY: {{1}} their first name, {{2}} the area, {{3}} where to book.
  launch_alert_v1: "Hello {{1}}, we now come to {{2}}. Your free consultation can be booked here: {{3}}",
  // To a referrer, when their friend's first fit closes as done (docs/decisions/0048-referrals.md), in the words for
  // what each side was given, which ops set apart (docs/decisions/0107-referral-rewards-in-the-console.md): the same,
  // different, nothing for the friend, or nothing for the referrer. PLACEHOLDER COPY: {{1}} the referrer's first name,
  // {{2}} the friend's, {{3}} the referrer's visits ("3 service visits"), {{4}} when they expire, {{5}} the friend's.
  friend_fitted_v2:
    "Hello {{1}}, {{2}} has been fitted. You each have {{3}} free, until {{4}}. Thank you for the introduction.",
  friend_fitted_each_v1:
    "Hello {{1}}, {{2}} has been fitted. You have {{3}} free, until {{4}}, and {{2}} has {{5}}. Thank you for the introduction.",
  friend_fitted_yours_v1:
    "Hello {{1}}, {{2}} has been fitted. You have {{3}} free, until {{4}}. Thank you for the introduction.",
  friend_fitted_thanks_v1: "Hello {{1}}, {{2}} has been fitted. Thank you for the introduction.",
  // To the friend, when the grant lands, and to a side that would have been given visits when ops reject a held one
  // (docs/decisions/0074-hand-offs-and-messages.md). PLACEHOLDER COPY: {{1}} the first name of the one told, and in
  // the credits {{2}} the visits ("3 service visits") and {{3}} when they expire, in the referrer's rejection {{2}}
  // the friend's first name.
  friend_credited_v2:
    "Hello {{1}}, your first fit is done, so the invite you came with gives you {{2}} free, until {{3}}. Your balance is in the app.",
  referral_rejected_referrer_v1:
    "Hello {{1}}, we could not give the service visits for {{2}}'s first fit. Message us if you would like to know why.",
  referral_rejected_friend_v1:
    "Hello {{1}}, we could not give the service visits from your invite. Message us if you would like to know why.",
  visit_cancelled_refund_v1:
    "Hello {{1}}, your {{2}} on {{3}} is cancelled. {{6}} is on its way back to your {{8}}, in 5 to 7 working days.",
  // A booking FSM would not take, which ops refunded or let go from the console (docs/decisions/0095-a-booking-fsm-refuses-is-held.md),
  // with the params of a message about a visit: {{1}} the first name, {{2}} the visit, {{3}} its day, {{6}} what was
  // paid and {{8}} where it goes back. PLACEHOLDER COPY, pending the owner's wording.
  booking_refunded_v1:
    "Hello {{1}}, we could not book your {{2}} on {{3}}. {{6}} is on its way back to your {{8}}, in 5 to 7 working days. You can book another time in the Mane Man app.",
  booking_not_made_v1:
    "Hello {{1}}, we could not book your {{2}} on {{3}}. You can book another time in the Mane Man app.",
  // The same, for a booking that moved a visit, which stays as it was: {{3}} is the day it was to move to.
  move_refunded_v1:
    "Hello {{1}}, we could not move your {{2}} to {{3}}, so it stays as it was booked. {{6}} is on its way back to your {{8}}, in 5 to 7 working days.",
  move_not_made_v1: "Hello {{1}}, we could not move your {{2}} to {{3}}, so it stays as it was booked.",
};

/** The text with its params filled in, or null for an unknown template or a missing param. */
export function renderMessage(name: string, params: readonly string[]): string | null {
  const template = TEMPLATES[name];
  if (template === undefined) return null;

  const positions = [...template.matchAll(PLACEHOLDER)].map((match) => Number(match[1]));
  if (positions.some((position) => params[position - 1] === undefined)) return null;
  return template.replace(PLACEHOLDER, (_match, position: string) => params[Number(position) - 1] ?? "");
}

const PLACEHOLDER = /\{\{(\d+)\}\}/g;

/** A count of service visits as the texts write it: "1 service visit", "3 service visits". */
export const serviceVisits = (count: number): string =>
  count === 1 ? "1 service visit" : `${String(count)} service visits`;

export function isKnownTemplate(name: string): boolean {
  return name in TEMPLATES;
}

/** The template the try-on result is sent with, in every environment. */
export const RESULT_TEMPLATE = "tryon_result_v1";

/**
 * Whether a kind of queued message answers the person whose own action on staging's screens produced it, or is
 * automatic: a scheduled job, or a message to someone other than the one who acted. On staging an answering kind
 * reaches any number; an automatic kind still checks `onAllowlist` (src/config/settings.ts). Production's
 * allowlist is empty, so this changes nothing there. Owner ruling, 30 September 2026 ("logins open, reminders
 * fenced"; ADR 0025 item 84; ADR 0097).
 */
export type MessageClass = "answering" | "automatic";

/**
 * Every kind, classed once. `reschedule_confirmation` and `visit_moved` render the same template
 * (`visit_moved_v1`) but differ here: the first is the client's own move, the second ops' on the dispatch board.
 * A kind added to MESSAGE_KINDS with no line here fails to typecheck (`Record<MessageKind, MessageClass>`), and
 * test/node/message-templates.test.ts checks the table still holds every kind, for a reader who only runs tests.
 */
export const MESSAGE_CLASSES: Readonly<Record<MessageKind, MessageClass>> = {
  tryon_result: "answering", // the result of the try-on the person just claimed
  consultation_confirmation: "answering", // the booking they just made
  payment_receipt: "answering",
  nothing_to_pay: "automatic", // the technician's close of a one visit, not the client's own action
  reschedule_confirmation: "answering", // the client's own move
  cancel_confirmation: "answering", // the client's own cancel
  waitlist_confirmation: "answering", // their own place on the list, just joined
  visit_reminder: "automatic", // the day-before cron
  visit_moved: "automatic", // ops moved it, on the dispatch board
  arrival_notice: "automatic", // the technician's own action, not the client's
  no_show_decided: "automatic", // ops ruled on it
  no_show_dispute_ruled: "automatic", // ops ruled on the client's dispute (ADR 0096)
  booking_refunded: "automatic", // ops refunded a booking FSM would not take (ADR 0095)
  next_service_reminder: "automatic", // scheduled
  friend_fitted: "automatic", // to the referrer, for the friend's action
  friend_credited: "automatic", // to the friend, for the job ops closed
  referral_rejected: "automatic", // ops' ruling
  launch_alert: "automatic", // scheduled, to someone who asked earlier
};

/** A kind's class, defaulting to automatic for one this table does not name, so an unsure case is never open. */
export function messageClass(kind: string): MessageClass {
  return (MESSAGE_KINDS as readonly string[]).includes(kind) ? MESSAGE_CLASSES[kind as MessageKind] : "automatic";
}
