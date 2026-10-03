// The WhatsApp texts we send, by template name: the bridge has no approved templates, so the texts live here.
// {{1}}, {{2}}, … are the params, in order. PLACEHOLDER COPY, pending the owner's wording.

import { MESSAGE_KINDS, type MessageKind } from "../domain/messages.ts";
import type { MessagePurpose } from "../policy/consents.ts";

export const TEMPLATES: Readonly<Record<string, string>> = {
  // The try-on's look, to the number that claimed it: {{1}} the first name. The second sentence is the design's own.
  tryon_result_v1:
    "Hello {{1}}, here is your Mane Man try-on. What you see is a simulation, not a photograph of a result.",
  // The login code, {{1}}.
  login_code_v1: "{{1}} is your Mane Man code. It works for ten minutes. We will never ask you for it.",
  // A visit's params: {{1}} first name, {{2}} visit, {{3}} day ("Thu 24 Sep"), {{4}} window ("12 to 4 pm"),
  // {{5}} technician, {{6}} amount ("Rs. 2,000"), {{7}} reference, {{8}} refund to, {{9}} minutes waited, {{10}} back.
  consultation_booked_v1: "Hello {{1}}, your free consultation is booked for {{3}}, {{4}}. We will see you then.",
  // The consultation and fit in one visit, booked from the site with nothing paid.
  one_visit_booked_v1:
    "Hello {{1}}, your consultation and fit is booked for {{3}}, {{4}}. You pay only once you are fitted.",
  visit_booked_v1:
    "Hello {{1}}, your {{2}} is booked for {{3}}, {{4}}, with {{5}}. Paid {{6}}, reference {{7}}. The receipt is in the app.",
  visit_booked_credit_v1:
    "Hello {{1}}, your {{2}} is booked for {{3}}, {{4}}, with {{5}}. One of your visit credits covers it.",
  // A visit a discount code made free: booked with nothing to pay.
  visit_booked_code_v1:
    "Hello {{1}}, your {{2}} is booked for {{3}}, {{4}}, with {{5}}. Your discount code covers it, so there is nothing to pay.",
  // A consultation and fit in one visit a discount code made free, once the client is fitted.
  visit_fitted_code_v1:
    "Hello {{1}}, you are fitted. Your discount code covers your hair system, so there is nothing to pay.",
  visit_reminder_v1: "Hello {{1}}, a reminder that your {{2}} is tomorrow, {{3}}, {{4}}, with {{5}}.",
  visit_moved_v1: "Hello {{1}}, your {{2}} is now on {{3}}, {{4}}, with {{5}}.",
  // At the technician's check-in, which is also the no-show's evidence.
  technician_arrived_v1: "Hello {{1}}, {{5}} has arrived for your {{2}}.",
  // Ops' ruling on a visit the client was not home for: {{6}} what is kept, {{10}} what goes back. Never ops' reason.
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
  // Ops' ruling on a client's dispute of a no-show charge: refunded, credit back or gone, or upheld. Never ops' reason.
  no_show_dispute_refunded_v1:
    "Hello {{1}}, we have looked at your dispute of the no-show charge for your {{2}} on {{3}}, and we are refunding it: {{6}} is on its way back to your {{8}}, in 5 to 7 working days.",
  no_show_dispute_credit_back_v1:
    "Hello {{1}}, we have looked at your dispute of the no-show charge for your {{2}} on {{3}}, and we are refunding it: your visit credit is back.",
  no_show_dispute_credit_gone_v1:
    "Hello {{1}}, we have looked at your dispute of the no-show charge for your {{2}} on {{3}}, and we agree the charge should not stand, but the visit credit it used is no longer valid, so it cannot come back.",
  no_show_dispute_upheld_v1:
    "Hello {{1}}, we have looked at your dispute of the no-show charge for your {{2}} on {{3}}. The charge stands. Message us if you would like to know why.",
  // Due in a few days with nothing booked: {{2}} "service visit" or "replacement", {{3}} the due day.
  next_visit_due_v1: "Hello {{1}}, your next {{2}} is due on {{3}}. You can book it in the Mane Man app.",
  visit_cancelled_v1: "Hello {{1}}, your {{2}} on {{3}} is cancelled.",
  visit_cancelled_credit_v1: "Hello {{1}}, your {{2}} on {{3}} is cancelled. Your visit credit is back.",
  // Cancelled too late, so the credit is spent, as the cancel sheet warned.
  visit_cancelled_credit_lost_v1:
    "Hello {{1}}, your {{2}} on {{3}} is cancelled. It was too close to the visit, so the visit credit it used is gone.",
  // Cancelled in time, but the credit's grant has since expired or been withdrawn.
  visit_cancelled_credit_gone_v1:
    "Hello {{1}}, your {{2}} on {{3}} is cancelled. The visit credit it used has expired, so it cannot come back.",
  // To someone on a pincode's waitlist, {{2}} the area ops named, else "pincode 400050"; only one who asked for the
  // launch alert is promised it.
  waitlist_listed_v1: "Hello {{1}}, you are on our list for {{2}}. We do not come there yet.",
  waitlist_listed_alert_v1:
    "Hello {{1}}, you are on our list for {{2}}. We will message you on WhatsApp when we come there.",
  // A pincode launched, to those on its waitlist who asked to be told: {{2}} the area ops named, else its city,
  // {{3}} where to book.
  launch_alert_v1: "Hello {{1}}, we now come to {{2}}. Your free consultation can be booked here: {{3}}",
  // To a referrer once the friend is fitted: {{2}} friend's name, {{3}} referrer's visits, {{4}} expiry, {{5}} friend's.
  friend_fitted_v2:
    "Hello {{1}}, {{2}} has been fitted. You each have {{3}} free, until {{4}}. Thank you for the introduction.",
  friend_fitted_each_v1:
    "Hello {{1}}, {{2}} has been fitted. You have {{3}} free, until {{4}}, and {{2}} has {{5}}. Thank you for the introduction.",
  friend_fitted_yours_v1:
    "Hello {{1}}, {{2}} has been fitted. You have {{3}} free, until {{4}}. Thank you for the introduction.",
  friend_fitted_thanks_v1: "Hello {{1}}, {{2}} has been fitted. Thank you for the introduction.",
  // To the friend once credited ({{2}} visits, {{3}} expiry); in a rejection to the referrer, {{2}} is the friend.
  friend_credited_v2:
    "Hello {{1}}, your first fit is done, so the invite you came with gives you {{2}} free, until {{3}}. Your balance is in the app.",
  referral_rejected_referrer_v1:
    "Hello {{1}}, we could not give the service visits for {{2}}'s first fit. Message us if you would like to know why.",
  referral_rejected_friend_v1:
    "Hello {{1}}, we could not give the service visits from your invite. Message us if you would like to know why.",
  visit_cancelled_refund_v1:
    "Hello {{1}}, your {{2}} on {{3}} is cancelled. {{6}} is on its way back to your {{8}}, in 5 to 7 working days.",
  // A booking FSM would not take, which ops refunded or let go, with a visit's params.
  booking_refunded_v1:
    "Hello {{1}}, we could not book your {{2}} on {{3}}. {{6}} is on its way back to your {{8}}, in 5 to 7 working days. You can book another time in the Mane Man app.",
  booking_not_made_v1:
    "Hello {{1}}, we could not book your {{2}} on {{3}}. You can book another time in the Mane Man app.",
  // The same, for a booking that moved a visit, which stays as it was: {{3}} is the day it was to move to.
  move_refunded_v1:
    "Hello {{1}}, we could not move your {{2}} to {{3}}, so it stays as it was booked. {{6}} is on its way back to your {{8}}, in 5 to 7 working days.",
  move_not_made_v1: "Hello {{1}}, we could not move your {{2}} to {{3}}, so it stays as it was booked.",
  // To a number our site's booking form was just sent for, since the page tells every number the same thing
  // (src/domain/site-notices.ts). PLACEHOLDER COPY, pending the owner's wording: {{1}} the first name, and for a
  // consultation still to happen {{2}} the visit, {{3}} its day and {{4}} its window.
  consultation_exists_v1:
    "Hello {{1}}, this number was just used to book on our site. Your {{2}} is already booked for {{3}}, {{4}}, so we have not booked another. You can see or move it in the Mane Man app.",
  book_in_app_v1:
    "Hello {{1}}, this number was just used to book on our site. As a Mane Man client, you book your next visit in the Mane Man app. Sign in with this number.",
  address_on_account_v1:
    "Hello {{1}}, we will come to the address already on your account, not the one typed on our site. You can change it in the Mane Man app.",
  // The line a reminder or alert ends with, {{1}} the link that stops them (STOP_LINKS below).
  stop_link_v1: "Stop these messages: {{1}}",
  // The answer to a STOP reply, once it has withdrawn something.
  messages_stopped_v1:
    "Done, {{1}}. We will no longer message you here about your visits, or when we come to a new area.",
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

/** The text, ending with the line that stops it when the message carries a stop link. */
export function renderWithStopLink(name: string, params: readonly string[], stopLink?: string): string | null {
  const text = renderMessage(name, params);
  if (text === null || stopLink === undefined) return text;
  return `${text}\n\n${renderMessage("stop_link_v1", [stopLink]) ?? ""}`;
}

/**
 * The messages that end with a link to stop them, and the consent the link withdraws: the reminders and the launch
 * alert, sent on a schedule rather than in answer to anything the person just did. A STOP reply stops every kind
 * sent under either consent.
 */
export const STOP_LINKS: Readonly<Partial<Record<MessageKind, MessagePurpose>>> = {
  visit_reminder: "whatsapp_visits",
  next_service_reminder: "whatsapp_visits",
  launch_alert: "whatsapp_launches",
};

/** The consent a kind's stop link withdraws, or null for a kind that carries none. */
export function stopLinkPurpose(kind: string): MessagePurpose | null {
  return STOP_LINKS[kind as MessageKind] ?? null;
}

/** A count of service visits as the texts write it: "1 service visit", "3 service visits". */
export const serviceVisits = (count: number): string =>
  count === 1 ? "1 service visit" : `${String(count)} service visits`;

export function isKnownTemplate(name: string): boolean {
  return name in TEMPLATES;
}

/** The template the try-on result is sent with, in every environment. */
export const RESULT_TEMPLATE = "tryon_result_v1";

/**
 * Whether a kind of queued message answers the person whose own action produced it, or is automatic: a scheduled
 * job, or a message to someone other than the one who acted. On staging an answering kind reaches any number; an
 * automatic kind still checks `onAllowlist` (src/config/settings.ts). Production's allowlist is empty.
 */
export type MessageClass = "answering" | "automatic";

/**
 * Every kind, classed once. `reschedule_confirmation` and `visit_moved` render the same template
 * (`visit_moved_v1`) but differ here: the first is the client's own move, the second ops' on the dispatch board.
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
  no_show_dispute_ruled: "automatic", // ops ruled on the client's dispute
  booking_refunded: "automatic", // ops refunded a booking that could not be made
  next_service_reminder: "automatic", // scheduled
  friend_fitted: "automatic", // to the referrer, for the friend's action
  friend_credited: "automatic", // to the friend, for the job ops closed
  referral_rejected: "automatic", // ops' ruling
  launch_alert: "automatic", // scheduled, to someone who asked earlier
  consultation_exists: "answering", // the site's booking form, just sent for this number
  book_in_app: "answering",
  address_on_account: "answering",
  messages_stopped: "answering", // their own STOP reply
};

/** A kind's class, defaulting to automatic for one this table does not name, so an unsure case is never open. */
export function messageClass(kind: string): MessageClass {
  return (MESSAGE_KINDS as readonly string[]).includes(kind) ? MESSAGE_CLASSES[kind as MessageKind] : "automatic";
}
