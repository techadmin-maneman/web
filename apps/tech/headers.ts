// The technician app's policy (docs/decisions/0026-hosts-and-surfaces.md). The
// app calls its own origin and nothing else, and grants itself the camera
// (board B1's guided capture) and geolocation (board B5's "I have arrived"),
// which no other origin may use through it.
//
// `connect-src 'self'` holds because a photograph goes up through mm-api, on the app's own host, and never
// straight to R2.

import type { AppPolicy } from "@maneman/web-kit/headers";

export const TECHNICIAN_APP_POLICY: AppPolicy = {
  features: ["camera", "geolocation"],
};
