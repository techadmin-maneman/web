// Money as the app writes it: "The ex-GST figure is the main number with the
// inclusive figure muted beside it" (docs/prompts/phase2-frontend.md, "Money").

import { rupees } from "@maneman/web-kit/money";
import type { Price } from "../api.ts";

/**
 * A late fee's two figures, for the one line boards C4, C5 and C7 all write
 * about moving inside 24 hours. The inclusive figure is given only once GST
 * applies, so the line reads as the boards draw it while GST is nothing.
 */
export function lateFeeFigures(fee: Price): { exGst: string; inclusive: string | null } {
  return {
    exGst: rupees(fee.amount_ex_gst),
    inclusive: fee.amount === fee.amount_ex_gst ? null : rupees(fee.amount),
  };
}
