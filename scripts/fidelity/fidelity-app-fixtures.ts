// Answers the client app's fidelity run (./fidelity-app.ts) gives that no screen's own fixture holds: the login's
// code as board A2 draws it, a service visit's price, and what a screen asks for that no board draws.

import type { Route } from "@playwright/test";
import type { components } from "../../apps/app/src/api-schema.ts";

/** A code sent 30 seconds ago, as board A2 is drawn: SMS offered, WhatsApp's resend 18 s away. */
export const CHALLENGE = {
  challenge_id: "0b6c2f0e-6a57-4f7e-9a51-3f0f5c1d2e44",
  channel: "whatsapp",
  expires_in_s: 600,
  resend_in_s: 48,
  sms_in_s: 30,
} satisfies components["schemas"]["LoginChallenge"];

/** A service visit's price as the booking boards draw it: Rs. 2,000 and 18% GST. */
export const SERVICE_PRICE = { amount_ex_gst: 200000, amount: 236000, gst_percent: 18 };

/**
 * What Home asks for beyond the boards, answered empty: unanswered, a call reads as signed out, and the app goes back
 * to its login.
 */
export const NOT_DRAWN: Readonly<Record<string, (route: Route) => Promise<void>>> = {
  "/api/me/custom-orders": (route) => route.fulfill({ json: { orders: [] } }),
};
