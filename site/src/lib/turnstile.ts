// The site's Turnstile site keys, which are public (docs/turnstile.md). The
// widget itself is shared with the client app (@maneman/web-kit/turnstile).

import type { SiteEnvironment } from "./environment.ts";

export const TURNSTILE_SITE_KEYS: Readonly<Record<SiteEnvironment, string>> = {
  local: "1x00000000000000000000AA", // Cloudflare's always-pass test key
  staging: "0x4AAAAAAE-0a-QSaClo_rF3",
  production: "0x4AAAAAAE-0bRotsEzMTpZV",
};
