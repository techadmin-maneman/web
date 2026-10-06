// The try-on's look goes to WhatsApp only (docs/decisions/0104-the-try-ons-look-on-whatsapp-only.md). The visitor
// gives their number before the look is made, and the look is sent to that number on WhatsApp, never shown on the site. So a
// try-on whose look could not be sent must not run: the routes ask before anything is uploaded, claimed or rendered
// (src/routes/public/tryon-upload.ts, tryon-claim.ts and tryon-generate.ts), and the page asks on arrival
// (GET /api/tryon/availability, src/routes/public/tryon-result.ts).

/**
 * One look per WhatsApp number every thirty days. The number is known before the look is made, so it is the number, not only the browser's cookie, that is
 * held to it. A look counts once its render was asked for and did not fail.
 */
export const LOOK_PER_NUMBER_DAYS = 30;

/**
 * Whether the try-on runs at all: its look can be sent only while WhatsApp is on (MESSAGING_ENABLED), which
 * production keeps off until its WhatsApp number goes live (docs/go-live.md).
 */
export function tryOnRuns(messaging: { readonly enabled: boolean }): boolean {
  return messaging.enabled;
}

/** Why a look made now would not reach the visitor's WhatsApp. */
type Undelivered = "whatsapp_off" | "held_back" | "number_capped";

interface DeliveryCheck {
  readonly messaging: { readonly enabled: boolean };
  /** Staging's allowlist holds back a message about one of our own scripts' test records (ADR 0097). */
  readonly heldBack: boolean;
  /** The number has had its result messages for the day (RESULT_MESSAGE_MOBILE_DAILY_LIMIT). */
  readonly capSpent: boolean;
}

/** Why the look for this number would not be sent, or null when it would be. */
export function undelivered(check: DeliveryCheck): Undelivered | null {
  if (!tryOnRuns(check.messaging)) return "whatsapp_off";
  if (check.heldBack) return "held_back";
  if (check.capSpent) return "number_capped";
  return null;
}
