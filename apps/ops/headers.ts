// The ops console's policy (docs/decisions/0026-hosts-and-surfaces.md). The
// console calls its own origin and nothing else: no payment provider, no
// camera, no popup. Cloudflare Access sits in front of the host, so the login
// happens before any of this is served.

import type { AppPolicy } from "@maneman/web-kit/headers";

export const OPS_CONSOLE_POLICY: AppPolicy = {};
