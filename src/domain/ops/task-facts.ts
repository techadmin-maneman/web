// What each task turns on, by its group, as the board reads it (./tasks.ts): each queue's statement writes its facts
// as one JSON object, and the board answers them typed, so the console reads fields rather than words by position.

import { PARTIAL_REASONS } from "../../config/job-sheet.ts";
import type { BookingWindow } from "../../config/scheduling.ts";
import type { VisitType } from "../../config/visit-types.ts";
import { offeredWindow } from "../../policy/next-visit.ts";
import type { TaskGroup } from "../../policy/tasks.ts";
import type { SlotSchedule } from "../booking/slot-times.ts";

/** A visit's start, an instant. */
type Instant = string;
/** A day, as YYYY-MM-DD. */
type Day = string;

export type TaskFacts =
  | { readonly group: "unanswered_chat"; readonly mobile: string }
  | { readonly group: "city_matter"; readonly note: string | null }
  | { readonly group: "remedy_approval"; readonly visits: number; readonly reason: string }
  | { readonly group: "untold_move"; readonly starts_at: Instant; readonly reason: "no_consent" | "not_sent" }
  | { readonly group: "move_unanswered"; readonly date: Day; readonly window: BookingWindow; readonly ran_out: boolean }
  | {
      readonly group: "consultation_request";
      readonly date: Day;
      readonly window: BookingWindow;
      readonly one_visit: boolean;
      readonly discount_code: string | null;
      /** A first fit asked for with it, and the window it was wanted in, null for either; null for none. */
      readonly first_fit: { readonly window: BookingWindow | null } | null;
    }
  | { readonly group: "replacement_order"; readonly piece_code: string; readonly due_on: Day }
  | { readonly group: "recall_call"; readonly piece_codes: string[] }
  | { readonly group: "stock_at_risk"; readonly consumable_code: string | null }
  | { readonly group: "referral_review"; readonly signal: string | null }
  | { readonly group: "grievance" }
  | { readonly group: "number_change" }
  | { readonly group: "erasure_request" }
  | { readonly group: "no_show_decision"; readonly technician: string | null }
  | { readonly group: "draft_invoice"; readonly invoice_id: string }
  | { readonly group: "unassigned_visit"; readonly kind: VisitType; readonly starts_at: Instant }
  | { readonly group: "visit_left_open"; readonly status: string; readonly starts_at: Instant }
  | { readonly group: "leave_conflict"; readonly starts_at: Instant; readonly technician: string }
  | { readonly group: "address_to_confirm"; readonly starts_at: Instant }
  | {
      readonly group: "partial_visit";
      readonly kind: VisitType;
      /** The technician's reason, or why ops closed it; null for neither. */
      readonly reason_code: string | null;
      /** The reason in the words ops gave it, or the job sheet's. */
      readonly reason: string | null;
    }
  | { readonly group: "at_risk_client"; readonly last_visit_at: Instant; readonly due_on: Day }
  | {
      readonly group: "first_fit_to_book";
      readonly consulted_at: Instant;
      /** The window the fit is offered in, the consultation's; null where a fit cannot start in it. */
      readonly fit_window: BookingWindow | null;
    }
  | {
      readonly group: "payment_owed";
      readonly state: "sent" | "unsent" | "refused" | "closed";
      /** In paise. */
      readonly amount: number;
      readonly url: string | null;
      readonly product: string;
    }
  | { readonly group: "no_show_dispute"; readonly kept: number | null }
  | {
      readonly group: "payment_to_refund";
      readonly why: "let_go" | "refund_failed";
      /** In paise. */
      readonly amount: number;
      readonly payment: string;
    };

/** A queue's row as the facts are read from it: its group, and the JSON object its statement wrote. */
interface FactsRow {
  readonly group: TaskGroup;
  readonly facts: string | null;
}

/**
 * The task's facts. What a statement cannot know is added here: the reason a partial visit's technician gave, in the
 * job sheet's words where ops saved none of their own, and the window a first fit to book is offered in.
 */
export function factsOf(row: FactsRow, schedule: SlotSchedule): TaskFacts {
  const written: Record<string, unknown> = { ...(JSON.parse(row.facts ?? "{}") as object), group: row.group };
  if (row.group === "partial_visit") {
    const code = typeof written.reason_code === "string" ? written.reason_code : null;
    const label = PARTIAL_REASONS.find((each) => each.id === code)?.label ?? code;
    return { ...written, reason: written.reason ?? label } as TaskFacts;
  }
  if (row.group === "first_fit_to_book" && typeof written.consulted_at === "string") {
    const window = offeredWindow("first_fit", schedule.at(written.consulted_at).window);
    return { ...written, fit_window: window ?? null } as TaskFacts;
  }
  return written as TaskFacts;
}
