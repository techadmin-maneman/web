// Money as the app writes it: the amount charged, GST included, is the main
// figure, and once GST applies its split sits beneath it.

import { rupees } from "@maneman/web-kit/money";
import { gstSplit } from "../content.ts";

/** A price, or a payment, whose split before GST may be unknown. */
interface Amount {
  readonly amount: number;
  readonly amount_ex_gst: number | null;
}

/**
 * An amount's two figures: what is charged, and how that splits once GST applies ("Rs. 30,000 + Rs. 5,400 GST").
 * The split is null while GST is nothing, and where no rate was recorded.
 */
export function priceFigures(price: Amount): { amount: string; split: string | null } {
  return { amount: rupees(price.amount), split: splitOf(price) };
}

function splitOf(price: Amount): string | null {
  if (price.amount_ex_gst === null || price.amount_ex_gst === price.amount) return null;
  return gstSplit(rupees(price.amount_ex_gst), rupees(price.amount - price.amount_ex_gst));
}
