// The WhatsApp texts we send, by template name: the bridge has no approved templates, so the texts live here.
// {{1}}, {{2}}, … are the params, in order.

import { MESSAGE_KINDS, type MessageKind } from "./message-kinds.ts";
import type { MessagePurpose } from "../policy/consents.ts";
import { isOneOf } from "../lib/one-of.ts";

export const TEMPLATES = {
  // The try-on's look, to the number that claimed it: {{1}} the first name, {{2}} where to book a consultation.
  tryon_result_v1:
    "Hi {{1}}, your new look is ready.\nIt's a preview: your hair system is matched to your own hair. See it for real at a free consultation: {{2}}",
  // The login code, {{1}}.
  login_code_v1: "{{1}} is your Mane Man code. It expires in 10 minutes. Don't share it with anyone.",
  // A visit's params: {{1}} first name, {{2}} visit, {{3}} day ("Thu 24 Sep"), {{4}} window ("12 to 4 pm"),
  // {{5}} technician, {{6}} amount ("Rs. 2,000"), {{7}} reference, {{8}} refund to, {{9}} minutes waited, {{10}} back.
  consultation_booked_v1:
    "Hi {{1}}, you're booked.\nYour free consultation is {{3}}, {{4}}, at home. To change it, open the Mane Man app.",
  // The consultation and fit in one visit, booked from the site with nothing paid.
  one_visit_booked_v1:
    "Hi {{1}}, you're booked.\nYour consultation and fit is {{3}}, {{4}}, at home. Choose your hair system with your technician, and pay only once you're fitted.",
  visit_booked_v1:
    "Hi {{1}}, you're booked.\nYour {{2}} is {{3}}, {{4}}, with {{5}}. We've received {{6}} (ref {{7}}). Your receipt is in the app.",
  visit_booked_credit_v1:
    "Hi {{1}}, you're booked.\nYour {{2}} is {{3}}, {{4}}, with {{5}}, covered by one of your free service visits.",
  // The receipt for a one visit paid by its link once the client is fitted: {{2}} the hair system.
  link_paid_v1:
    "Hi {{1}}, thank you: payment received.\n{{6}} for your {{2}} (ref {{7}}). Welcome to Mane Man. Your receipt is in the app.",
  // A visit a discount code made free: booked with nothing to pay.
  visit_booked_code_v1:
    "Hi {{1}}, you're booked.\nYour {{2}} is {{3}}, {{4}}, with {{5}}. Your discount code covers it: nothing to pay.",
  // A consultation and fit in one visit a discount code made free, once the client is fitted.
  visit_fitted_code_v1: "Hi {{1}}, welcome to Mane Man.\nYour discount code covers your hair system: nothing to pay.",
  visit_reminder_v1:
    "Hi {{1}}, see you tomorrow.\nYour {{2}} is {{3}}, {{4}}, with {{5}}. Need to move it? Open the Mane Man app.",
  visit_moved_v1:
    "Hi {{1}}, your booking has moved.\nYour {{2}} is now {{3}}, {{4}}, with {{5}}. See it in the Mane Man app.",
  // A move to another day ops ask the client to confirm (ADR 0115): {{3}} the visit's day now, {{4}} and {{5}} the day
  // and window proposed, {{6}} the technician there.
  move_proposed_v1:
    "Hi {{1}}, we need to move a booking.\nYour {{2}} on {{3}}: could you do {{4}}, {{5}}, with {{6}} instead? Accept it, or pick another time, in the Mane Man app.",
  // At the technician's check-in, which is also the no-show's evidence.
  technician_arrived_v1: "Hi {{1}}, {{5}} is at your door for your visit.",
  // The technician's word from the job card (src/domain/messages/technician-updates.ts), with a visit's params:
  // {{5}} the technician, {{9}} the minutes.
  technician_on_the_way_v1: "Hi {{1}}, {{5}} is on the way, about {{9}} minutes.",
  technician_at_gate_v1: "Hi {{1}}, {{5}} is at your gate.",
  technician_running_late_v1: "Hi {{1}}, {{5}} is running about {{9}} minutes late. Sorry for the wait.",
  // Ops' ruling on a visit the client was not home for: {{6}} what is kept, {{10}} what goes back. Never ops' reason.
  no_show_missed_v1:
    "Hi {{1}}, we missed you.\n{{5}} waited {{9}} minutes for your {{2}} on {{3}} but couldn't reach you. Book a new time in the Mane Man app.",
  no_show_charged_paid_v1:
    "Hi {{1}}, we missed you.\n{{5}} waited {{9}} minutes for your {{2}} on {{3}} but couldn't reach you. We've kept the {{6}} you paid as the no-show charge. If you were home, dispute it in the Mane Man app.",
  no_show_charged_fee_v1:
    "Hi {{1}}, we missed you.\n{{5}} waited {{9}} minutes for your {{2}} on {{3}} but couldn't reach you. We've kept {{6}} as the no-show charge and refunded {{10}} to your {{8}} (5 to 7 working days). If you were home, dispute it in the Mane Man app.",
  no_show_charged_credit_v1:
    "Hi {{1}}, we missed you.\n{{5}} waited {{9}} minutes for your {{2}} on {{3}} but couldn't reach you. The free service visit it used counts as the no-show charge. If you were home, dispute it in the Mane Man app.",
  no_show_waived_v1:
    "Hi {{1}}, we missed you.\n{{5}} waited {{9}} minutes for your {{2}} on {{3}} but couldn't reach you. There's no charge. Book a new time in the Mane Man app.",
  no_show_waived_paid_v1:
    "Hi {{1}}, we missed you.\n{{5}} waited {{9}} minutes for your {{2}} on {{3}} but couldn't reach you. There's no charge. Message us about the {{6}} you paid.",
  no_show_waived_credit_v1:
    "Hi {{1}}, we missed you.\n{{5}} waited {{9}} minutes for your {{2}} on {{3}} but couldn't reach you. There's no charge. Message us about the free service visit it used.",
  no_show_waived_refund_v1:
    "Hi {{1}}, we missed you.\n{{5}} waited {{9}} minutes for your {{2}} on {{3}} but couldn't reach you. There's no charge: we've refunded {{6}} to your {{8}} (5 to 7 working days).",
  no_show_waived_credit_back_v1:
    "Hi {{1}}, we missed you.\n{{5}} waited {{9}} minutes for your {{2}} on {{3}} but couldn't reach you. There's no charge, and your free service visit is back.",
  // A credit given back to a grant that has since expired or been clawed back does not come back; ops are told.
  no_show_waived_credit_gone_v1:
    "Hi {{1}}, we missed you.\n{{5}} waited {{9}} minutes for your {{2}} on {{3}} but couldn't reach you. There's no charge, but the free service visit it used has expired, so we can't return it.",
  // Ops' ruling on a client's dispute of a no-show charge: refunded, credit back or gone, or upheld. Never ops' reason.
  no_show_dispute_refunded_v1:
    "Hi {{1}}, we've reviewed your dispute.\nAbout your {{2}} on {{3}}: we've refunded {{6}} to your {{8}} (5 to 7 working days).",
  no_show_dispute_credit_back_v1:
    "Hi {{1}}, we've reviewed your dispute.\nAbout your {{2}} on {{3}}: your free service visit is back.",
  no_show_dispute_credit_gone_v1:
    "Hi {{1}}, we've reviewed your dispute.\nAbout your {{2}} on {{3}}: the charge shouldn't stand, but the free service visit it used has expired, so we can't return it.",
  no_show_dispute_upheld_v1:
    "Hi {{1}}, we've reviewed your dispute.\nAbout your {{2}} on {{3}}: the charge stands. Message us if you'd like to know why.",
  // Due in a few days with nothing booked: {{2}} "service visit" or "replacement", {{3}} the due day.
  next_visit_due_v1:
    "Hi {{1}}, time to book your next visit.\nYour {{2}} is due on {{3}}. Book it in the Mane Man app.",
  visit_cancelled_v1:
    "Hi {{1}}, your booking is cancelled.\nThat's your {{2}} on {{3}}. Book a new time whenever suits you, in the Mane Man app.",
  visit_cancelled_credit_v1:
    "Hi {{1}}, your booking is cancelled.\nThat's your {{2}} on {{3}}. Your free service visit is back.",
  // Cancelled too late, so the credit is spent, as the cancel sheet warned.
  visit_cancelled_credit_lost_v1:
    "Hi {{1}}, your booking is cancelled.\nThat's your {{2}} on {{3}}. As it was cancelled late, the free service visit it used can't be returned.",
  // Cancelled in time, but the credit's grant has since expired or been withdrawn.
  visit_cancelled_credit_gone_v1:
    "Hi {{1}}, your booking is cancelled.\nThat's your {{2}} on {{3}}. The free service visit it used has expired, so we can't return it.",
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
    "Hi {{1}}, {{2}} has joined Mane Man: thank you for sending them our way.\nYou each get {{3}} free, to use by {{4}}.",
  friend_fitted_each_v1:
    "Hi {{1}}, {{2}} has joined Mane Man: thank you for sending them our way.\nYou get {{3}} free, to use by {{4}}, and {{2}} gets {{5}}.",
  friend_fitted_yours_v1:
    "Hi {{1}}, {{2}} has joined Mane Man: thank you for sending them our way.\nYou get {{3}} free, to use by {{4}}.",
  friend_fitted_thanks_v1: "Hi {{1}}, {{2}} has joined Mane Man: thank you for sending them our way.",
  // To the friend once credited ({{2}} visits, {{3}} expiry); in a rejection to the referrer, {{2}} is the friend.
  friend_credited_v2:
    "Hi {{1}}, welcome to Mane Man.\nYour invite gives you {{2}} free, to use by {{3}}. They're in the app.",
  referral_rejected_referrer_v1:
    "Hi {{1}}, about your invite to {{2}}.\nWe couldn't add free service visits for it. Message us if you'd like to know why.",
  referral_rejected_friend_v1:
    "Hi {{1}}, we couldn't add free service visits from your invite. Message us if you'd like to know why.",
  // A month, then a week, before free service visits run out: {{2}} how many end that day, {{3}} their last day.
  credits_expiring_v1:
    "Hi {{1}}, you have {{2}} free to book by {{3}}.\nA visit booked by then is covered, even on a later date. Book in the Mane Man app.",
  visit_cancelled_refund_v1:
    "Hi {{1}}, your booking is cancelled.\nThat's your {{2}} on {{3}}. We've refunded {{6}} to your {{8}} (5 to 7 working days).",
  // A booking given back, with a visit's params: one paid after its hold lapsed, or a move whose visit had begun.
  booking_refunded_v1:
    "Hi {{1}}, we couldn't confirm your booking.\nYour {{2}} on {{3}} didn't go through, so we've refunded {{6}} to your {{8}} (5 to 7 working days). Book another time in the Mane Man app. Our apologies.",
  booking_not_made_v1:
    "Hi {{1}}, we couldn't confirm your booking.\nYour {{2}} on {{3}} didn't go through. Book another time in the Mane Man app. Our apologies.",
  // The same, for a booking a free service visit was to pay for, which the client still has.
  booking_not_made_credit_v1:
    "Hi {{1}}, we couldn't confirm your booking.\nYour {{2}} on {{3}} didn't go through, but your free service visit is still yours. Book another time in the Mane Man app. Our apologies.",
  // The same, for a booking that moved a visit, which stays as it was: {{3}} is the day it was to move to.
  move_refunded_v1:
    "Hi {{1}}, your booking hasn't changed.\nWe couldn't move your {{2}} to {{3}}, so it stays as booked. We've refunded {{6}} to your {{8}} (5 to 7 working days).",
  move_not_made_v1:
    "Hi {{1}}, your booking hasn't changed.\nWe couldn't move your {{2}} to {{3}}, so it stays as booked.",
  // To a number our site's booking form was just sent for, since the page tells every number the same thing
  // (src/domain/ops/site-notices.ts): {{1}} the first name, and for a consultation still to happen {{2}} the visit, {{3}}
  // its day and {{4}} its window.
  consultation_exists_v1:
    "Hi {{1}}, this number was just used to book on our site.\nYour {{2}} is already booked for {{3}}, {{4}}, so we haven't booked another. See or move it in the Mane Man app.",
  book_in_app_v1:
    "Hi {{1}}, this number was just used to book on our site.\nAs a Mane Man client, you book in the Mane Man app. Sign in with this number.",
  address_on_account_v1:
    "Hi {{1}}, we'll come to the address on your account, not the one typed on our site.\nTo change it, open the Mane Man app.",
  // {{2}} the pincode of the address on the account.
  address_not_served_v1:
    "Hi {{1}}, this number was just used to book on our site.\nThe address on your account is at pincode {{2}}, which we don't cover yet, so nothing was booked. If you've moved, change your address in the Mane Man app and book there.",
  // Ops' decision on a client's request to delete their account. {{2}} is ops' reason, which they write knowing the
  // client reads it.
  deletion_rejected_v1:
    "Hi {{1}}, we haven't deleted your Mane Man account.\nOur reason: {{2}} Message us if you disagree.",
  // Ops' answer to a concern the client raised about their data. The answer itself is in the app, under Profile.
  concern_answered_v1: "Hi {{1}}, we've answered your concern.\nRead our reply in the Mane Man app, under Profile.",
  // Sent once the erasure is done, to the number it has just blanked.
  deletion_done_v1:
    "Hi {{1}}, as you asked, we've deleted your Mane Man account.\nYour invoices are kept for eight years, as the law requires.",
  // The line a reminder or alert ends with, {{1}} the link that stops them (STOP_LINKS below).
  stop_link_v1: "Stop these messages: {{1}}",
  // The answer to a STOP reply, once it has withdrawn something.
  messages_stopped_v1: "Done, {{1}}. We won't message you here about your visits, or when we come to a new area.",
  // The answer to a message sent outside Customer Care's hours (src/domain/care/after-hours.ts): {{1}} when Care open,
  // {{2}} when the message is answered by.
  care_after_hours_v1: "Thank you for your message.\nOur team is back at {{1}} and will reply by {{2}}.",
} as const satisfies Readonly<Record<string, string>>;

/** A template's name: a misspelt one is a type error, never a message that does not go. */
export type TemplateName = keyof typeof TEMPLATES;

/**
 * The words the Words page set for a message and for its stop line, where they differ from the code's
 * (docs/decisions/0128-messages-with-the-words-set.md). The page keeps each one's params as the code has them.
 */
export interface Wording {
  readonly text?: string;
  readonly stop?: string;
}

/** The text with its params filled in, or null for an unknown template or a missing param. */
export function renderMessage(name: TemplateName, params: readonly string[], wording?: string): string | null {
  const template: string = wording ?? TEMPLATES[name];

  const positions = [...template.matchAll(PARAM)].map((match) => Number(match[1]));
  if (positions.some((position) => params[position - 1] === undefined)) return null;
  return template.replace(PARAM, (_match, position: string) => params[Number(position) - 1] ?? "");
}

const PARAM = /\{\{(\d+)\}\}/g;

/** The text, ending with the line that stops it when the message carries a stop link; in the words set, if any. */
export function renderWithStopLink(
  name: TemplateName,
  params: readonly string[],
  stopLink?: string,
  wording: Wording = {},
): string | null {
  const text = renderMessage(name, params, wording.text);
  if (text === null || stopLink === undefined) return text;
  return `${text}\n\n${renderMessage("stop_link_v1", [stopLink], wording.stop) ?? ""}`;
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
  move_proposed: "automatic", // ops ask, on the dispatch board
  arrival_notice: "automatic", // the technician's own action, not the client's
  technician_update: "automatic", // the same, from the job card
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
  concern_answered: "answering", // the answer to their own concern
  messages_stopped: "answering", // their own STOP reply
};

/** A kind's class, defaulting to automatic for one this table does not name, so an unsure case is never open. */
export function messageClass(kind: string): MessageClass {
  return isOneOf(MESSAGE_KINDS, kind) ? MESSAGE_CLASSES[kind] : "automatic";
}
