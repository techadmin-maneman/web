// Money as the app writes it: "The ex-GST figure is the main number with the
// inclusive figure muted beside it" (docs/prompts/phase2-frontend.md, "Money").

import { rupees } from "@maneman/web-kit/money";
import type { Price } from "../api.ts";

/**
 * A price's two figures: for the one line boards C4, C5 and C7 all write about
 * moving inside 24 hours, and for each visit the client may choose between.
 * The inclusive figure is given only once GST applies, so the line reads as
 * the boards draw it while GST is nothing.
 */
export function priceFigures(price: Price): { exGst: string; inclusive: string | null } {
  return {
    exGst: rupees(price.amount_ex_gst),
    inclusive: price.amount === price.amount_ex_gst ? null : rupees(price.amount),
  };
}
