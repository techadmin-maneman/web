// The try-on's look goes to WhatsApp only (docs/decisions/0104-the-try-ons-look-on-whatsapp-only.md): the owner's
// list of 1 October 2026, item 10, in the owner's words, and their ruling D3 the same day. The visitor gives their
// number before the look is made, and the look is sent to that number on WhatsApp, never shown on the site. So a
// try-on whose look could not be sent must not run: the routes ask before anything is uploaded, claimed or rendered
// (src/routes/tryon-upload.ts, tryon-claim.ts and tryon-generate.ts), and the page asks on arrival
// (GET /api/tryon/availability, src/routes/tryon-result.ts).

/** The owner's list of 1 October 2026, item 10 (ADR 0025, item 88). */
export const RULING = "Try-on images are sent to WhatsApp for privacy, not shown on the site.";

export const RULES = [RULING] as const;

/**
 * Whether the try-on runs at all: its look can be sent only while WhatsApp is on (MESSAGING_ENABLED), which
 * production keeps off until its WhatsApp number goes live (docs/go-live.md).
 */
export function tryOnRuns(messaging: { readonly enabled: boolean }): boolean {
  return messaging.enabled;
}

/** Why a look made now would not reach the visitor's WhatsApp. */
export type Undelivered = "whatsapp_off" | "held_back" | "number_capped";

export interface DeliveryCheck {
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
