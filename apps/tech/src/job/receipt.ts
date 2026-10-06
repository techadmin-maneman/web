import { ICONS } from "@maneman/brand/icons";
import type { Job } from "../api.ts";
import { notHome as copy } from "../content.ts";
import { clock } from "../lib/when.ts";

export interface ReceiptLine {
  readonly text: string;
  /** A tick only for a WhatsApp delivered: one sent and never delivered, or none at all, proves nothing. */
  readonly icon: string;
}

/** The evidence chain's receipt beneath the wait: whether a WhatsApp went to the client, and whether it reached his phone. */
export function receiptLine(reminder: Job["reminder"], who: string): ReceiptLine {
  if (reminder === null) return { text: copy.waiting.noneSent(who), icon: ICONS.cross };
  if (reminder.delivered_at === null) return { text: copy.waiting.notDelivered(who), icon: ICONS.minus };
  return { text: copy.waiting.delivered(who, clock(reminder.delivered_at)), icon: ICONS.tick };
}
