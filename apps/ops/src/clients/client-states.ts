// Where a client stands, as its pill's tone: fitted is done, booked is under way, nothing booked a client to win back.

import type { BadgeTone } from "@maneman/ui/Badge";
import type { ClientRecord } from "../api.ts";

export const STATE_TONES: Readonly<Record<ClientRecord["state"], BadgeTone>> = {
  fitted: "done",
  lead: "attention",
  nothing_booked: "neutral",
};
