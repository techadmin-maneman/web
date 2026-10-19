// The login's code as the client app's board A2 draws it, for the fidelity run (./fidelity-app.ts).

import type { components } from "../../apps/app/src/api-schema.ts";

/** A code sent 30 seconds ago, as board A2 is drawn: SMS offered, WhatsApp's resend 18 s away. */
export const CHALLENGE = {
  challenge_id: "0b6c2f0e-6a57-4f7e-9a51-3f0f5c1d2e44",
  channel: "whatsapp",
  expires_in_s: 600,
  resend_in_s: 48,
  sms_in_s: 30,
} satisfies components["schemas"]["LoginChallenge"];
