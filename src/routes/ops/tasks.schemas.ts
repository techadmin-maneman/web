// What each task on the board turns on, by its group (src/domain/ops/task-facts.ts), as GET /api/tasks answers it.

import { z } from "@hono/zod-openapi";
import { BOOKING_WINDOWS } from "../../config/scheduling.ts";
import { VISIT_TYPES } from "../../config/visit-types.ts";

const instant = z.iso.datetime();
const day = z.iso.date();
const paise = z.number().int();
const window = z.enum(BOOKING_WINDOWS);
const kind = z.enum(VISIT_TYPES);

const facts = <Group extends string, Shape extends z.ZodRawShape>(group: Group, shape: Shape) =>
  z.object({ group: z.literal(group), ...shape }).strict();

export const TaskFactsSchema = z
  .discriminatedUnion("group", [
    facts("unanswered_chat", { mobile: z.string() }),
    facts("city_matter", { note: z.string().nullable() }),
    facts("remedy_approval", { visits: z.number().int(), reason: z.string() }),
    facts("untold_move", {
      starts_at: instant.openapi({ description: "The start the visit moved to." }),
      reason: z.enum(["no_consent", "not_sent"]),
    }),
    facts("move_unanswered", { date: day, window, ran_out: z.boolean() }),
    facts("consultation_request", {
      date: day,
      window,
      one_visit: z.boolean(),
      discount_code: z.string().nullable(),
      first_fit: z.object({ window: window.nullable() }).strict().nullable().openapi({
        description: "A first fit asked for with it, and the window wanted, null for either; null for none.",
      }),
    }),
    facts("replacement_order", { piece_code: z.string(), due_on: day }),
    facts("recall_call", { piece_codes: z.array(z.string()) }),
    facts("stock_at_risk", { consumable_code: z.string().nullable() }),
    facts("referral_review", { signal: z.string().nullable().openapi({ description: "The first fraud rule met." }) }),
    facts("grievance", {}),
    facts("number_change", {}),
    facts("erasure_request", {}),
    facts("no_show_decision", { technician: z.string().nullable() }),
    facts("draft_invoice", { invoice_id: z.string() }),
    facts("unassigned_visit", { kind, starts_at: instant }),
    facts("visit_left_open", { status: z.string(), starts_at: instant }),
    facts("leave_conflict", { starts_at: instant, technician: z.string() }),
    facts("address_to_confirm", { starts_at: instant }),
    facts("partial_visit", {
      kind,
      reason_code: z.string().nullable(),
      reason: z.string().nullable().openapi({ description: "In the words ops gave it, or the job sheet's." }),
    }),
    facts("at_risk_client", { last_visit_at: instant, due_on: day }),
    facts("first_fit_to_book", {
      consulted_at: instant,
      fit_window: window
        .nullable()
        .openapi({ description: "The consultation's; null where a fit cannot start in it." }),
    }),
    facts("upi_due", {
      kind,
      starts_at: instant,
      amount: paise.openapi({ description: "Paid by UPI at the visit, in paise." }),
    }),
    facts("payment_owed", {
      state: z.enum(["sent", "unsent", "refused", "closed"]),
      amount: paise,
      url: z.string().nullable().openapi({ description: "Null until Razorpay made the link." }),
      product: z.string(),
    }),
    facts("no_show_dispute", { kept: paise.nullable().openapi({ description: "What the charge kept, in paise." }) }),
    facts("payment_to_refund", {
      why: z.enum(["let_go", "refund_failed"]),
      amount: paise.openapi({ description: "Owed back, in paise." }),
      payment: z.string().openapi({ description: "The Razorpay payment to refund it from." }),
    }),
  ])
  .openapi("TaskFacts", { description: "What the task turns on, by its group." });
