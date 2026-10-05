// The technician app's policy (docs/decisions/0026-hosts-and-surfaces.md). The
// app calls its own origin and nothing else, and grants itself the camera
// (board B1's guided capture) and geolocation (board B5's "I have arrived"),
// which no other origin may use through it.
//
// `connect-src 'self'` holds while photographs are confirmed through mm-api. If
// The technician API's upload route hands the phone a presigned R2 URL to PUT to, that host
// is added here and nowhere else (docs/prompts/phase2-frontend.md, Security).

import type { AppPolicy } from "@maneman/web-kit/headers";

export const TECHNICIAN_APP_POLICY: AppPolicy = {
  features: ["camera", "geolocation"],
};
