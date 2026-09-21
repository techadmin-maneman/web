// Files the build writes beside the pages, different per environment: the
// Workers static-assets `_headers` file and robots.txt. Staging and local are
// never indexed; the smoke check (scripts/lib/smoke.ts) looks for it.
//
// F4 adds the security headers and production's sitemap here.

import type { SiteEnvironment } from "./environment.ts";

export function headersFile(environment: SiteEnvironment): string {
  if (environment === "production") return "";
  return "/*\n  X-Robots-Tag: noindex, nofollow\n";
}

export function robotsFile(environment: SiteEnvironment): string {
  if (environment === "production") return "User-agent: *\nAllow: /\n";
  return "User-agent: *\nDisallow: /\n";
}
