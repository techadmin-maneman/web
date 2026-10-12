// The ops console's policy (docs/decisions/0026-hosts-and-surfaces.md). The
// console calls its own origin and nothing else: no payment provider, no
// popup. It grants itself the camera, which reads a label's QR code
// (docs/decisions/0162-scanning-labels.md), and no other origin may use it
// through the console. Cloudflare Access sits in front of the host, so the
// login happens before any of this is served.

import type { AppPolicy } from "@maneman/web-kit/headers";

export const OPS_CONSOLE_POLICY: AppPolicy = { features: ["camera"] };
