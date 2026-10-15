// A task's second line: the one fact its group turns on, in ops' words, from the facts the API gives each task by its
// group. The table is keyed by every group the API names, so the console builds only once each has its line.

import { fullDate, indiaClock, indiaDate, shortDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import type { Task } from "../api.ts";
import { dispatch, referrals, tasks } from "../content.ts";
import { untoldMoveOf } from "./untold-move.ts";

type Facts = Task["facts"];
type Group = Facts["group"];
type Sub<G extends Group> = (facts: Extract<Facts, { group: G }>, task: Task, now: Date) => string;

const copy = tasks.subs;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** The reason a fit closed with "Can't fit today" (NO_PIECE in src/policy/in-job-steps.ts). */
const NO_PIECE = "no_piece";

/** The fraud rules, as the Referrals design letters them: a held grant is the same grant on both screens. */
const SIGNALS: Readonly<Record<string, string>> = referrals.queue.signals;

/** A window's name, as the dispatch board writes it, for the window a first fit is wanted in; null for either. */
const fitWindow = (window: keyof typeof dispatch.windows | null): string | null =>
  window === null ? null : dispatch.windows[window];

/** Whole weeks from one instant to another. */
const weeksBetween = (from: string, to: Date): number => Math.floor((to.getTime() - Date.parse(from)) / WEEK_MS);

/** A day and the time on it: "Wed 23 Sep, 9:00 am". */
const dayAndTime = (instant: string) => `${shortDate(indiaDate(instant))}, ${indiaClock(instant)}`;

/** A consultation asked for: its day and window, then the one visit and its code, or the first fit asked with it. */
const consultationAsked: Sub<"consultation_request"> = (facts) => {
  const asked = copy.consultation_request(fullDate(facts.date), dispatch.windows[facts.window]);
  if (facts.one_visit) {
    return `${asked} ${copy.withOneVisit}${facts.discount_code === null ? "" : copy.withCode(facts.discount_code)}`;
  }
  return facts.first_fit === null ? asked : `${asked} ${copy.withFirstFit(fitWindow(facts.first_fit.window))}`;
};

const SUBS: { readonly [G in Group]: Sub<G> } = {
  unanswered_chat: (_, task) => copy.unanswered_chat(dayAndTime(task.since)),
  city_matter: (facts) => (facts.note === null ? tasks.unknown : copy.city_matter(facts.note)),
  remedy_approval: (facts) => copy.remedy_approval(facts.visits),
  untold_move: (facts) => untoldMoveOf(facts),
  move_unanswered: (facts) => {
    const when = `${shortDate(facts.date)}, ${dispatch.windows[facts.window].toLowerCase()}`;
    return facts.ran_out ? copy.move_unanswered.ranOut(when) : copy.move_unanswered.open(when);
  },
  consultation_request: consultationAsked,
  // The piece's label, and the day it falls due; the order goes in by the task's own day.
  replacement_order: (facts, task) =>
    copy.replacement_order(facts.piece_code, fullDate(indiaDate(task.due)), fullDate(facts.due_on)),
  recall_call: (facts) => copy.recall_call(facts.piece_codes.join(" ")),
  stock_at_risk: (facts) => copy.stock_at_risk(facts.name ?? facts.consumable_code ?? ""),
  referral_review: (facts) => SIGNALS[facts.signal ?? ""] ?? copy.unknown,
  grievance: () => copy.grievance,
  number_change: () => copy.number_change,
  erasure_request: () => copy.erasure_request,
  no_show_decision: (facts) => (facts.technician === null ? copy.unknown : copy.no_show_decision(facts.technician)),
  draft_invoice: (_, task) => copy.draft_invoice(shortDate(indiaDate(task.since))),
  unassigned_visit: (facts) => copy.unassigned_visit(dispatch.typeNames[facts.kind], dayAndTime(facts.starts_at)),
  visit_left_open: (facts) =>
    copy.visit_left_open(shortDate(indiaDate(facts.starts_at)), facts.status === "in_progress"),
  leave_conflict: (facts) => copy.leave_conflict(dayAndTime(facts.starts_at), facts.technician),
  address_to_confirm: (facts) => copy.address_to_confirm(dayAndTime(facts.starts_at)),
  // The technician's reason in the job sheet's words, and the day they closed the visit.
  partial_visit: (facts, task) => {
    const reason = facts.reason_code === NO_PIECE ? copy.noPiece : (facts.reason ?? copy.noReason);
    return copy.partial_visit(reason, shortDate(indiaDate(task.since)));
  },
  at_risk_client: (facts, _, now) =>
    copy.at_risk_client(weeksBetween(facts.last_visit_at, now), shortDate(facts.due_on)),
  first_fit_to_book: (facts) =>
    copy.first_fit_to_book(shortDate(indiaDate(facts.consulted_at)), fitWindow(facts.fit_window)),
  payment_owed: (facts) => copy.payment_owed(facts.product, rupees(facts.amount), facts.state),
  upi_due: (facts) => copy.upi_due(dispatch.typeNames[facts.kind], dayAndTime(facts.starts_at), rupees(facts.amount)),
  // What the charge kept, or, where it kept no money, the credit it spent.
  no_show_dispute: (facts) =>
    copy.no_show_dispute(facts.kept !== null && facts.kept > 0 ? rupees(facts.kept) : copy.disputedCredit),
  // What is owed back, the Razorpay payment to refund it from, and why.
  payment_to_refund: (facts) => copy.payment_to_refund(rupees(facts.amount), facts.payment, facts.why),
};

/** The second line of a task. */
export const subOf = (task: Task, now: Date): string =>
  (SUBS[task.facts.group] as (facts: Facts, task: Task, now: Date) => string)(task.facts, task, now);
