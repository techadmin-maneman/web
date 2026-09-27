// The texts of the WhatsApp messages we send, by template name. RESULT_TEMPLATE
// picks the try-on result's. Evolution has no Meta-approved templates, so the
// text lives here; an official BSP would hold its own copy.
//
// PLACEHOLDER COPY, pending the owner's wording. The second sentence is the
// design's own ("a simulation, not a photograph of a result").
//
// {{1}}, {{2}}, … are the params, in order, as in WhatsApp templates.

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
  // minutes the technician waited, for a no-show.
  consultation_booked_v1: "Hello {{1}}, your free consultation is booked for {{3}}, {{4}}. We will see you then.",
  visit_booked_v1:
    "Hello {{1}}, your {{2}} is booked for {{3}}, {{4}}, with {{5}}. Paid {{6}}, reference {{7}}. The receipt is in the app.",
  visit_booked_credit_v1:
    "Hello {{1}}, your {{2}} is booked for {{3}}, {{4}}, with {{5}}. One of your visit credits covers it.",
  visit_reminder_v1: "Hello {{1}}, a reminder that your {{2}} is tomorrow, {{3}}, {{4}}, with {{5}}.",
  visit_moved_v1: "Hello {{1}}, your {{2}} is now on {{3}}, {{4}}, with {{5}}.",
  // At the technician's check-in (docs/decisions/0074-hand-offs-and-messages.md), the no-show's evidence.
  technician_arrived_v1: "Hello {{1}}, {{5}} has arrived for your {{2}}.",
  // Ops' ruling on a visit the client was not home for (docs/decisions/0074-hand-offs-and-messages.md), with {{9}}
  // the minutes the technician waited. A charge keeps what was paid, as a cancel inside 24 hours does; a waiver
  // refunds the payment and returns the credit, as the owner ruled on 27 September 2026 (src/policy/no-show.ts,
  // WAIVER_GIVES_BACK), and the two texts that ask the client to message us stand only for the switch turned off.
  // Booking again is in the app, never a message to us: the owner ruled on 27 September 2026 that "Message us" is for
  // problems only (ADR 0025, item 70). Never ops' reason, which stays with the ruling.
  no_show_missed_v1:
    "Hello {{1}}, we came for your {{2}} on {{3}} and waited {{9}} minutes, but nobody was home. You can book again in the Mane Man app.",
  no_show_charged_paid_v1:
    "Hello {{1}}, we came for your {{2}} on {{3}} and waited {{9}} minutes, but nobody was home. As with a cancel inside 24 hours, the {{6}} you paid for it is kept. Message us if this is wrong.",
  no_show_charged_credit_v1:
    "Hello {{1}}, we came for your {{2}} on {{3}} and waited {{9}} minutes, but nobody was home. As with a cancel inside 24 hours, the visit credit it used is gone. Message us if this is wrong.",
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
  // The next visit falls due in a few days and nothing is booked (docs/decisions/0086-the-next-visit-is-offered.md),
  // sent once a last visit, only with the client's consent to WhatsApp about their visits. PLACEHOLDER COPY, pending
  // the owner's wording: {{1}} the client's first name, {{2}} the visit ("service visit", or "replacement" where the
  // piece falls due first), {{3}} the day it falls due ("Tue 27 Oct").
  next_visit_due_v1: "Hello {{1}}, your next {{2}} is due on {{3}}. You can book it in the Mane Man app.",
  visit_cancelled_v1: "Hello {{1}}, your {{2}} on {{3}} is cancelled.",
  visit_cancelled_credit_v1: "Hello {{1}}, your {{2}} on {{3}} is cancelled. Your visit credit is back.",
  // A credit-paid visit cancelled inside 24 hours keeps its credit, as the cancel sheet warned; one cancelled in time
  // whose grant has since expired or been withdrawn cannot take it back (docs/decisions/0068-a-paid-hold-is-kept.md).
  visit_cancelled_credit_lost_v1:
    "Hello {{1}}, your {{2}} on {{3}} is cancelled. It was inside 24 hours, so the visit credit it used is gone.",
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
  // To a referrer, when their friend's first fit closes as done (docs/decisions/0048-referrals.md). PLACEHOLDER COPY:
  // {{1}} the referrer's first name, {{2}} the friend's, {{3}} the visits each gets, {{4}} when they expire.
  friend_fitted_v1:
    "Hello {{1}}, {{2}} has been fitted. You each have {{3}} service visits free, until {{4}}. Thank you for the introduction.",
  // To the friend, when the grant lands, and to both sides when ops reject a held one
  // (docs/decisions/0074-hand-offs-and-messages.md). PLACEHOLDER COPY: {{1}} the first name of the one told, and in
  // the credits {{2}} the visits and {{3}} when they expire, in the referrer's rejection {{2}} the friend's first name.
  friend_credited_v1:
    "Hello {{1}}, your first fit is done, so the invite you came with gives you {{2}} service visits free, until {{3}}. They are in the app.",
  referral_rejected_referrer_v1:
    "Hello {{1}}, we could not give the service visits for {{2}}'s first fit. Message us if you would like to know why.",
  referral_rejected_friend_v1:
    "Hello {{1}}, we could not give the service visits from your invite. Message us if you would like to know why.",
  visit_cancelled_refund_v1:
    "Hello {{1}}, your {{2}} on {{3}} is cancelled. {{6}} is on its way back to your {{8}}, in 5 to 7 working days.",
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

export function isKnownTemplate(name: string): boolean {
  return name in TEMPLATES;
}

/** The template the try-on result is sent with, in every environment. */
export const RESULT_TEMPLATE = "tryon_result_v1";
