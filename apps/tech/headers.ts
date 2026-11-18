// The technician app's policy (docs/decisions/0026-hosts-and-surfaces.md). The
// app calls its own origin and nothing else, and grants itself the camera
// (the camera's guided capture) and geolocation (the evidence chain's "I have arrived"),
// which no other origin may use through it.
//
// `connect-src 'self'` holds because a photograph goes up through mm-api, on the app's own host, and never
// straight to R2. Turnstile, which asking for a login code needs, loads its script and frames its check from
// challenges.cloudflare.com.

import type { AppPolicy } from "@maneman/web-kit/headers";

const TURNSTILE = "https://challenges.cloudflare.com";

export const TECHNICIAN_APP_POLICY: AppPolicy = {
  features: ["camera", "geolocation"],
  scripts: [TURNSTILE],
  frames: [TURNSTILE],
};
