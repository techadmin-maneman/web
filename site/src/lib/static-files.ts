// Files the build writes beside the pages, different per environment: the
// Workers static-assets `_headers` file, robots.txt and the sitemap.
//
// The content security policy allows only the site itself, Turnstile,
// Cloudflare Web Analytics (injected at the edge) and the analytics tags in
// use. Astro's inline scripts and styles are allowed by their hashes, which
// the build reads from the finished pages, so no 'unsafe-inline' is needed.
// Staging and local are never indexed; the smoke check looks for it.

import { createHash } from "node:crypto";
import { WHATSAPP_NUMBER, whatsappChat } from "@maneman/web-kit/whatsapp";
import type { AnalyticsIds } from "./analytics-ids.ts";
import type { SiteEnvironment } from "./environment.ts";
import { SITE_ORIGIN } from "./site-origin.ts";

/** Cloudflare's own limit on a line of `_headers`. */
export const HEADER_LINE_LIMIT = 2000;

const TURNSTILE = "https://challenges.cloudflare.com";
const WEB_ANALYTICS = { script: "https://static.cloudflareinsights.com", connect: "https://cloudflareinsights.com" };

/** The hash source for an inline script or style, as a policy writes it. */
export function cspHash(content: string): string {
  return `'sha256-${createHash("sha256").update(content, "utf8").digest("base64")}'`;
}

/** The inline scripts and styles in a page. JSON-LD is data, not script, and needs no hash. */
export function inlineCode(html: string): { scripts: string[]; styles: string[] } {
  const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
    .filter(([, attributes = ""]) => !/\bsrc=/.test(attributes) && !attributes.includes("application/ld+json"))
    .map(([, , content = ""]) => content);
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(([, content = ""]) => content);
  return { scripts, styles };
}

/** The hosts each analytics tag loads from and reports to, from the vendors' CSP guides. */
function analyticsSources(ids: AnalyticsIds) {
  const google = ids.ga4 !== null || ids.googleAds !== null;
  const ads = ids.googleAds !== null;
  const meta = ids.metaPixel !== null;
  const pick = (entries: [boolean, string[]][]) => entries.flatMap(([use, hosts]) => (use ? hosts : []));
  return {
    script: pick([
      [google, ["https://www.googletagmanager.com"]],
      [ads, ["https://www.googleadservices.com", "https://www.google.com"]],
      [meta, ["https://connect.facebook.net"]],
    ]),
    connect: pick([
      [google, ["https://*.google-analytics.com", "https://*.analytics.google.com", "https://*.googletagmanager.com"]],
      [ads, ["https://*.doubleclick.net", "https://www.google.com"]],
      [meta, ["https://www.facebook.com", "https://connect.facebook.net"]],
    ]),
    image: pick([
      [google, ["https://*.google-analytics.com", "https://*.googletagmanager.com"]],
      [ads, ["https://googleads.g.doubleclick.net", "https://www.google.com", "https://www.google.co.in"]],
      [meta, ["https://www.facebook.com"]],
    ]),
    frame: pick([[ads, ["https://td.doubleclick.net", "https://www.googletagmanager.com"]]]),
  };
}

export function contentSecurityPolicy(inline: { scripts: string[]; styles: string[] }, ids: AnalyticsIds): string {
  const analytics = analyticsSources(ids);
  const hashes = (contents: string[]) => [...new Set(contents.map(cspHash))].sort();
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", ...hashes(inline.scripts), TURNSTILE, WEB_ANALYTICS.script, ...analytics.script]],
    ["style-src", ["'self'", ...hashes(inline.styles)]],
    // blob: is the try-on's photograph and result, shown from memory.
    ["img-src", ["'self'", "blob:", ...analytics.image]],
    ["font-src", ["'self'"]],
    ["media-src", ["'self'"]],
    ["connect-src", ["'self'", WEB_ANALYTICS.connect, ...analytics.connect]],
    ["frame-src", [TURNSTILE, ...analytics.frame]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];
  return directives.map(([name, sources]) => [name, ...new Set(sources)].join(" ")).join("; ");
}

/** The camera is allowed on /try only, for "Use the camera". */
const PERMISSIONS = (camera: string) => `camera=${camera}, microphone=(), geolocation=(), payment=(), usb=()`;

export function headersFile(environment: SiteEnvironment, csp: string): string {
  const everyPage = [
    `Content-Security-Policy: ${csp}`,
    // Two years, for every host under the site's, as the apps send it (packages/web-kit/headers.ts). No preload: the
    // owner's call, since leaving the preload list takes months (ADR 0023, 1).
    "Strict-Transport-Security: max-age=63072000; includeSubDomains",
    "Referrer-Policy: strict-origin-when-cross-origin",
    "X-Content-Type-Options: nosniff",
    `Permissions-Policy: ${PERMISSIONS("()")}`,
    ...(environment === "production" ? [] : ["X-Robots-Tag: noindex, nofollow"]),
  ];
  const rules: [string, string[]][] = [
    ["/*", everyPage],
    ["/try", ["! Permissions-Policy", `Permissions-Policy: ${PERMISSIONS("(self)")}`]],
    // Built files carry a content hash in their names, so they never change.
    ["/_astro/*", ["Cache-Control: public, max-age=31536000, immutable"]],
  ];
  const text = rules.map(([path, lines]) => [path, ...lines.map((line) => `  ${line}`)].join("\n")).join("\n");
  return `${text}\n`;
}

/**
 * /.well-known/security.txt (RFC 9116): where to report a weakness, until a year from the build, as the RFC asks of
 * its expiry. Each deploy writes it afresh, so it lapses only on a site left a year unbuilt. The business's WhatsApp is
 * the one contact the site publishes.
 */
export function securityTxt(builtAt: Date): string {
  const expires = new Date(builtAt.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();
  return `Contact: ${whatsappChat(WHATSAPP_NUMBER)}\nExpires: ${expires}\nPreferred-Languages: en\n`;
}

export function robotsFile(environment: SiteEnvironment): string {
  if (environment === "production") return `User-agent: *\nAllow: /\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`;
  return "User-agent: *\nDisallow: /\n";
}

/**
 * The built pages no search engine is given: the 404, and the pages a single person's link opens. r.html answers
 * every /r/:code, each one a person's invite; /stop is opened from a person's own message.
 */
const UNLISTED_PAGES = new Set(["404.html", "r.html", "stop.html"]);

/** The page a built file serves, for the sitemap: index.html is /, try.html is /try. */
export function pagePath(file: string): string | null {
  if (!file.endsWith(".html") || UNLISTED_PAGES.has(file)) return null;
  return file === "index.html" ? "/" : `/${file.slice(0, -".html".length)}`;
}

/**
 * The built assets nothing refers to. The images module imports every design file so that staging can show the
 * placeholders; a production build shows none of them, and must not publish them at an address nobody links to.
 */
export function unreferencedAssets(assets: readonly string[], texts: readonly string[]): string[] {
  return assets.filter((asset) => !texts.some((text) => text.includes(asset)));
}

export function sitemapFile(paths: readonly string[]): string {
  const urls = paths.map((path) => `  <url><loc>${SITE_ORIGIN}${path}</loc></url>`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}
