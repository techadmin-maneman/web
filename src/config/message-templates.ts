// The WhatsApp texts we send, by template name: the bridge has no approved templates, so the texts live here.
// {{1}}, {{2}}, … are the params, in order. The owner approved the texts on 4 October 2026 (docs/open-points.md,
// item 39).

import { MESSAGE_KINDS, type MessageKind } from "./message-kinds.ts";
import type { MessagePurpose } from "../policy/consents.ts";
import { isOneOf } from "../lib/one-of.ts";

export const TEMPLATES = {
  // The try-on's look, to the number that claimed it: {{1}} the first name, {{2}} where to book a consultation.
  tryon_result_v1:
    "Hi {{1}}, here's your new look from Mane Man. It's a simulation: your real hair system is matched to your own hair. See it for real at a free consultation: {{2}}",
  // The login code, {{1}}.
  login_code_v1: "{{1}} is your Mane Man code. It expires in 10 minutes. Don't share it with anyone.",
  // A visit's params: {{1}} first name, {{2}} visit, {{3}} day ("Thu 24 Sep"), {{4}} window ("12 to 4 pm"),
  // {{5}} technician, {{6}} amount ("Rs. 2,000"), {{7}} reference, {{8}} refund to, {{9}} minutes waited, {{10}} back.
  consultation_booked_v1:
    "Hi {{1}}, your free consultation is booked for {{3}}, {{4}}. Your technician comes to you. To change it, open the Mane Man app.",
  // The consultation and fit in one visit, booked from the site with nothing paid.
  one_visit_booked_v1:
    "Hi {{1}}, your consultation and fit is booked for {{3}}, {{4}}. Choose your hair system with your technician. You only pay once you're fitted.",
  visit_booked_v1:
    "Hi {{1}}, your {{2}} is booked for {{3}}, {{4}}, with {{5}}. We've received {{6}} (ref {{7}}). Your receipt is in the app.",
  visit_booked_credit_v1:
    "Hi {{1}}, your {{2}} is booked for {{3}}, {{4}}, with {{5}}. It's covered by one of your free service visits.",
  // The receipt for a one visit paid by its link once the client is fitted: {{2}} the hair system.
  link_paid_v1:
    "Hi {{1}}, thank you: we've received {{6}} for your {{2}} (ref {{7}}). Welcome to Mane Man. Your receipt is in the app.",
  // A visit a discount code made free: booked with nothing to pay.
  visit_booked_code_v1:
    "Hi {{1}}, your {{2}} is booked for {{3}}, {{4}}, with {{5}}. Your discount code covers it, so there's nothing to pay.",
  // A consultation and fit in one visit a discount code made free, once the client is fitted.
  visit_fitted_code_v1:
    "Hi {{1}}, welcome to Mane Man. Your discount code covers your hair system, so there's nothing to pay.",
  visit_reminder_v1:
    "Hi {{1}}, see you tomorrow: your {{2}} is {{3}}, {{4}}, with {{5}}. Need to move it? Open the Mane Man app.",
  visit_moved_v1: "Hi {{1}}, your {{2}} is now on {{3}}, {{4}}, with {{5}}.",
  // At the technician's check-in, which is also the no-show's evidence.
  technician_arrived_v1: "Hi {{1}}, {{5}} is at your door for your {{2}}.",
  // Ops' ruling on a visit the client was not home for: {{6}} what is kept, {{10}} what goes back. Never ops' reason.
  no_show_missed_v1:
    "Hi {{1}}, {{5}} waited {{9}} minutes for your {{2}} on {{3}} but couldn't reach you. Book a new time in the Mane Man app.",
  no_show_charged_paid_v1:
    "Hi {{1}}, {{5}} waited {{9}} minutes for your {{2}} on {{3}} but couldn't reach you. We've kept the {{6}} you paid as the no-show charge. If you were home, dispute it in the Mane Man app.",
  no_show_charged_fee_v1:
    "Hi {{1}}, {{5}} waited {{9}} minutes for your {{2}} on {{3}} but couldn't reach you. We've kept {{6}} as the no-show charge and refunded {{10}} to your {{8}} (5 to 7 working days). If you were home, dispute it in the Mane Man app.",
  no_show_charged_credit_v1:
    "Hi {{1}}, {{5}} waited {{9}} minutes for your {{2}} on {{3}} but couldn't reach you. The free service visit it used counts as the no-show charge. If you were home, dispute it in the Mane Man app.",
  no_show_waived_v1:
    "Hi {{1}}, {{5}} waited {{9}} minutes for your {{2}} on {{3}} but couldn't reach you. There's no charge. Book a new time in the Mane Man app.",
  no_show_waived_paid_v1:
    "Hi {{1}}, {{5}} waited {{9}} minutes for your {{2}} on {{3}} but couldn't reach you. There's no charge. Message us about the {{6}} you paid.",
  no_show_waived_credit_v1:
    "Hi {{1}}, {{5}} waited {{9}} minutes for your {{2}} on {{3}} but couldn't reach you. There's no charge. Message us about the free service visit it used.",
  no_show_waived_refund_v1:
    "Hi {{1}}, {{5}} waited {{9}} minutes for your {{2}} on {{3}} but couldn't reach you. There's no charge: we've refunded {{6}} to your {{8}} (5 to 7 working days).",
  no_show_waived_credit_back_v1:
    "Hi {{1}}, {{5}} waited {{9}} minutes for your {{2}} on {{3}} but couldn't reach you. There's no charge, and your free service visit is back.",
  // A credit given back to a grant that has since expired or been clawed back does not come back; ops are told.
  no_show_waived_credit_gone_v1:
    "Hi {{1}}, {{5}} waited {{9}} minutes for your {{2}} on {{3}} but couldn't reach you. There's no charge, but the free service visit it used has expired, so we can't return it.",
  // Ops' ruling on a client's dispute of a no-show charge: refunded, credit back or gone, or upheld. Never ops' reason.
  no_show_dispute_refunded_v1:
    "Hi {{1}}, we've reviewed your dispute about your {{2}} on {{3}} and refunded {{6}} to your {{8}} (5 to 7 working days).",
  no_show_dispute_credit_back_v1:
    "Hi {{1}}, we've reviewed your dispute about your {{2}} on {{3}} and returned your free service visit.",
  no_show_dispute_credit_gone_v1:
    "Hi {{1}}, we've reviewed your dispute about your {{2}} on {{3}}, and the charge shouldn't stand. The free service visit it used has expired, so we can't return it.",
  no_show_dispute_upheld_v1:
    "Hi {{1}}, we've reviewed your dispute about your {{2}} on {{3}}. The charge stands. Message us if you'd like to know why.",
  // Due in a few days with nothing booked: {{2}} "service visit" or "replacement", {{3}} the due day.
  next_visit_due_v1: "Hi {{1}}, your next {{2}} is due on {{3}}. Book it in the Mane Man app.",
  visit_cancelled_v1: "Hi {{1}}, we've cancelled your {{2}} on {{3}}.",
  visit_cancelled_credit_v1: "Hi {{1}}, we've cancelled your {{2}} on {{3}}. Your free service visit is back.",
  // Cancelled too late, so the credit is spent, as the cancel sheet warned.
  visit_cancelled_credit_lost_v1:
    "Hi {{1}}, we've cancelled your {{2}} on {{3}}. As it was cancelled late, the free service visit it used can't be returned.",
  // Cancelled in time, but the credit's grant has since expired or been withdrawn.
  visit_cancelled_credit_gone_v1:
    "Hi {{1}}, we've cancelled your {{2}} on {{3}}. The free service visit it used has expired, so we can't return it.",
  // To someone on a pincode's waitlist, {{2}} the area ops named, else "pincode 400050"; only one who asked for the
  // launch alert is promised it.
  waitlist_listed_v1: "Hi {{1}}, you're on our list for {{2}}. We don't cover it yet.",
  waitlist_listed_alert_v1:
    "Hi {{1}}, you're on our list for {{2}}. We'll WhatsApp you as soon as we start coming there.",
  // A pincode launched, to those on its waitlist who asked to be told: {{2}} the area ops named, else its city,
  // {{3}} where to book.
  launch_alert_v1: "Hi {{1}}, Mane Man now comes to {{2}}. Book your free consultation: {{3}}",
  // To a referrer once the friend is fitted: {{2}} friend's name, {{3}} referrer's visits, {{4}} expiry, {{5}} friend's.
  friend_fitted_v2:
    "Hi {{1}}, {{2}} has been fitted. You each get {{3}} free, to use by {{4}}. Thanks for sending them our way.",
  friend_fitted_each_v1:
    "Hi {{1}}, {{2}} has been fitted. You get {{3}} free, to use by {{4}}, and {{2}} gets {{5}}. Thanks for sending them our way.",
  friend_fitted_yours_v1:
    "Hi {{1}}, {{2}} has been fitted. You get {{3}} free, to use by {{4}}. Thanks for sending them our way.",
  friend_fitted_thanks_v1: "Hi {{1}}, {{2}} has been fitted. Thanks for sending them our way.",
  // To the friend once credited ({{2}} visits, {{3}} expiry); in a rejection to the referrer, {{2}} is the friend.
  friend_credited_v2:
    "Hi {{1}}, welcome to Mane Man. Your invite gives you {{2}} free, to use by {{3}}. You'll find them in the app.",
  referral_rejected_referrer_v1:
    "Hi {{1}}, we couldn't add free service visits for {{2}}'s fit. Message us if you'd like to know why.",
  referral_rejected_friend_v1:
    "Hi {{1}}, we couldn't add free service visits from your invite. Message us if you'd like to know why.",
  // A month, then a week, before free service visits run out: {{2}} how many end that day, {{3}} their last day.
  credits_expiring_v1:
    "Hi {{1}}, you have {{2}} free to book by {{3}}. A visit booked by then is covered, even on a later date. Book in the Mane Man app.",
  visit_cancelled_refund_v1:
    "Hi {{1}}, we've cancelled your {{2}} on {{3}} and refunded {{6}} to your {{8}} (5 to 7 working days).",
  // A booking given back, with a visit's params: one paid after its hold lapsed, or a move whose visit had begun.
  booking_refunded_v1:
    "Hi {{1}}, we couldn't confirm your {{2}} on {{3}}, so we've refunded {{6}} to your {{8}} (5 to 7 working days). Book another time in the Mane Man app. Sorry about that.",
  booking_not_made_v1:
    "Hi {{1}}, we couldn't confirm your {{2}} on {{3}}. Book another time in the Mane Man app. Sorry about that.",
  // The same, for a booking a free service visit was to pay for, which the client still has.
  booking_not_made_credit_v1:
    "Hi {{1}}, we couldn't confirm your {{2}} on {{3}}. Your free service visit is still yours: book another time in the Mane Man app. Sorry about that.",
  // The same, for a booking that moved a visit, which stays as it was: {{3}} is the day it was to move to.
  move_refunded_v1:
    "Hi {{1}}, we couldn't move your {{2}} to {{3}}, so it stays as booked. We've refunded {{6}} to your {{8}} (5 to 7 working days).",
  move_not_made_v1: "Hi {{1}}, we couldn't move your {{2}} to {{3}}, so it stays as booked.",
  // To a number our site's booking form was just sent for, since the page tells every number the same thing
  // (src/domain/site-notices.ts): {{1}} the first name, and for a consultation still to happen {{2}} the visit, {{3}}
  // its day and {{4}} its window.
  consultation_exists_v1:
    "Hi {{1}}, this number was just used to book on our site. Your {{2}} is already booked for {{3}}, {{4}}, so we haven't booked another. See or move it in the Mane Man app.",
  book_in_app_v1:
    "Hi {{1}}, this number was just used to book on our site. As a Mane Man client, you book in the Mane Man app. Sign in with this number.",
  address_on_account_v1:
    "Hi {{1}}, we'll come to the address on your account, not the one typed on our site. Change it in the Mane Man app.",
  // {{2}} the pincode of the address on the account.
  address_not_served_v1:
    "Hi {{1}}, this number was just used to book on our site. The address on your account is at pincode {{2}}, which we don't cover yet, so nothing was booked. If you've moved, change your address in the Mane Man app and book there.",
  // Ops' decision on a client's request to delete their account. {{2}} is ops' reason, which they write knowing the
  // client reads it.
  deletion_rejected_v1:
    "Hi {{1}}, we haven't deleted your Mane Man account. Our reason: {{2}} Message us if you disagree.",
  // Sent once the erasure is done, to the number it has just blanked.
  deletion_done_v1:
    "Hi {{1}}, as you asked, we've deleted your Mane Man account. Your invoices are kept for eight years, as the law requires.",
  // The line a reminder or alert ends with, {{1}} the link that stops them (STOP_LINKS below).
  stop_link_v1: "Stop these messages: {{1}}",
  // The answer to a STOP reply, once it has withdrawn something.
  messages_stopped_v1: "Done, {{1}}. We won't message you here about your visits, or when we come to a new area.",
} as const satisfies Readonly<Record<string, string>>;

/** A template's name: a misspelt one is a type error, never a message that does not go. */
export type TemplateName = keyof typeof TEMPLATES;

/** The text with its params filled in, or null for an unknown template or a missing param. */
export function renderMessage(name: TemplateName, params: readonly string[]): string | null {
  const template: string = TEMPLATES[name];

  const positions = [...template.matchAll(PARAM)].map((match) => Number(match[1]));
  if (positions.some((position) => params[position - 1] === undefined)) return null;
  return template.replace(PARAM, (_match, position: string) => params[Number(position) - 1] ?? "");
}

const PARAM = /\{\{(\d+)\}\}/g;

/** The text, ending with the line that stops it when the message carries a stop link. */
export function renderWithStopLink(name: TemplateName, params: readonly string[], stopLink?: string): string | null {
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
  credits_expiring: "whatsapp_visits",
  launch_alert: "whatsapp_launches",
};

/** The consent a kind's stop link withdraws, or null for a kind that carries none. */
export function stopLinkPurpose(kind: string): MessagePurpose | null {
  return STOP_LINKS[kind as MessageKind] ?? null;
}

/** A count of service visits as the texts write it: "1 service visit", "3 service visits". */
export const serviceVisits = (count: number): string =>
  count === 1 ? "1 service visit" : `${String(count)} service visits`;

export function isKnownTemplate(name: string): name is TemplateName {
  return name in TEMPLATES;
}

/** The template the try-on result is sent with, in every environment. */
export const RESULT_TEMPLATE: TemplateName = "tryon_result_v1";

/**
 * Whether a kind of queued message answers the person whose own action produced it, or is automatic: a scheduled
 * job, or a message to someone other than the one who acted. On staging an answering kind reaches any number; an
 * automatic kind still checks `onAllowlist` (src/config/settings.ts). Production's allowlist is empty.
 */
type MessageClass = "answering" | "automatic";

/**
 * Every kind, classed once. `reschedule_confirmation` and `visit_moved` render the same template
 * (`visit_moved_v1`) but differ here: the first is the client's own move, the second ops' on the dispatch board.
 */
export const MESSAGE_CLASSES: Readonly<Record<MessageKind, MessageClass>> = {
  tryon_result: "answering", // the result of the try-on the person just claimed
  consultation_confirmation: "answering", // the booking they just made
  payment_receipt: "answering",
  nothing_to_pay: "automatic", // the technician's close of a one visit, not the client's own action
  link_paid: "answering", // the client's own payment
  reschedule_confirmation: "answering", // the client's own move
  cancel_confirmation: "answering", // the client's own cancel
  visit_cancelled: "automatic", // ops cancelled it, in the console
  waitlist_confirmation: "answering", // their own place on the list, just joined
  visit_reminder: "automatic", // the day-before cron
  visit_moved: "automatic", // ops moved it, on the dispatch board
  arrival_notice: "automatic", // the technician's own action, not the client's
  no_show_decided: "automatic", // ops ruled on it
  no_show_dispute_ruled: "automatic", // ops ruled on the client's dispute
  booking_refunded: "automatic", // a booking given back by itself
  next_service_reminder: "automatic", // scheduled
  friend_fitted: "automatic", // to the referrer, for the friend's action
  friend_credited: "automatic", // to the friend, for the job ops closed
  referral_rejected: "automatic", // ops' ruling
  credits_expiring: "automatic", // scheduled
  launch_alert: "automatic", // scheduled, to someone who asked earlier
  consultation_exists: "answering", // the site's booking form, just sent for this number
  book_in_app: "answering",
  address_on_account: "answering",
  address_not_served: "answering",
  deletion_rejected: "automatic", // ops' ruling
  messages_stopped: "answering", // their own STOP reply
};

/** A kind's class, defaulting to automatic for one this table does not name, so an unsure case is never open. */
export function messageClass(kind: string): MessageClass {
  return isOneOf(MESSAGE_KINDS, kind) ? MESSAGE_CLASSES[kind] : "automatic";
}
