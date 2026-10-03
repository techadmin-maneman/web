// What the build writes beside the pages: the security headers, robots.txt
// and the sitemap (site/src/lib/static-files.ts).

import { describe, expect, it } from "vitest";
import type { AnalyticsIds } from "../../site/src/lib/analytics-ids.ts";
import {
  contentSecurityPolicy,
  cspHash,
  HEADER_LINE_LIMIT,
  headersFile,
  inlineCode,
  pagePath,
  robotsFile,
  sitemapFile,
} from "../../site/src/lib/static-files.ts";

const NO_TAGS: AnalyticsIds = { ga4: null, googleAds: null, metaPixel: null };
const EVERY_TAG: AnalyticsIds = {
  ga4: "G-TEST000000",
  googleAds: { id: "AW-000000000", bookingLabel: "booking", tryOnLabel: "tryon" },
  metaPixel: "000000000000000",
};

const PAGE = `<html><head>
<script>if (location.hash === "#book") location.replace("/book");</script>
<script type="module" src="/_astro/a.js"></script>
<script type="application/ld+json">{"@type":"FAQPage"}</script>
<style>astro-island{display:contents}</style>
</head></html>`;

describe("the content security policy", () => {
  it("allows the page's inline scripts and styles by hash, and never JSON-LD or external files", () => {
    const inline = inlineCode(PAGE);
    expect(inline.scripts).toEqual(['if (location.hash === "#book") location.replace("/book");']);
    expect(inline.styles).toEqual(["astro-island{display:contents}"]);
    const policy = contentSecurityPolicy(inline, NO_TAGS);
    expect(policy).toContain(`script-src 'self' ${cspHash(inline.scripts[0] ?? "")}`);
    expect(policy).toContain(`style-src 'self' ${cspHash(inline.styles[0] ?? "")}`);
    expect(policy).not.toContain("unsafe-inline");
    expect(policy).not.toContain("unsafe-eval");
  });

  it("allows only the site, Turnstile and Cloudflare Web Analytics when no tag is set", () => {
    const policy = contentSecurityPolicy({ scripts: [], styles: [] }, NO_TAGS);
    expect(policy).toBe(
      [
        "default-src 'self'",
        "script-src 'self' https://challenges.cloudflare.com https://static.cloudflareinsights.com",
        "style-src 'self'",
        "img-src 'self' blob:",
        "font-src 'self'",
        "media-src 'self'",
        "connect-src 'self' https://cloudflareinsights.com",
        "frame-src https://challenges.cloudflare.com",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join("; "),
    );
  });

  it("adds each tag's hosts only when the tag is set", () => {
    const policy = contentSecurityPolicy({ scripts: [], styles: [] }, EVERY_TAG);
    for (const host of [
      "https://www.googletagmanager.com",
      "https://connect.facebook.net",
      "https://td.doubleclick.net",
    ]) {
      expect(policy).toContain(host);
    }
    const metaOnly = contentSecurityPolicy({ scripts: [], styles: [] }, { ...NO_TAGS, metaPixel: "1" });
    expect(metaOnly).toContain("https://connect.facebook.net");
    expect(metaOnly).not.toContain("google");
  });

  it("fits Cloudflare's line limit with every tag and a dozen inline scripts", () => {
    const scripts = Array.from({ length: 12 }, (_, i) => `console.log(${String(i)})`);
    const file = headersFile("production", contentSecurityPolicy({ scripts, styles: ["a{}", "b{}"] }, EVERY_TAG));
    for (const line of file.split("\n")) expect(line.length).toBeLessThanOrEqual(HEADER_LINE_LIMIT);
  });
});

describe("the headers file", () => {
  it("sends HSTS, the referrer policy and no camera, except on /try", () => {
    const file = headersFile("production", "default-src 'self'");
    // SEC-02: the same as the apps send (packages/web-kit/headers.ts), for every host under the site's.
    expect(file).toContain("  Strict-Transport-Security: max-age=63072000; includeSubDomains\n");
    expect(file).toContain("  Referrer-Policy: strict-origin-when-cross-origin\n");
    expect(file).toMatch(/\/\*\n[\s\S]*Permissions-Policy: camera=\(\),/);
    expect(file).toContain("/try\n  ! Permissions-Policy\n  Permissions-Policy: camera=(self),");
    expect(file).not.toContain("X-Robots-Tag");
  });

  it("keeps staging and local out of search engines", () => {
    expect(headersFile("staging", "x")).toContain("X-Robots-Tag: noindex, nofollow");
    expect(robotsFile("staging")).toBe("User-agent: *\nDisallow: /\n");
    expect(robotsFile("production")).toContain("Sitemap: https://maneman.in/sitemap.xml");
  });
});

describe("the sitemap", () => {
  // The referral landing answers every /r/:code, each one a person's own invite, and /stop opens from a person's own
  // message; neither is indexed.
  it("lists each page by its address, and neither the 404, the referral landing nor /stop", () => {
    const files = ["index.html", "try.html", "404.html", "privacy.html", "r.html", "stop.html"];
    const paths = files.map(pagePath).filter((path) => path !== null);
    expect(paths).toEqual(["/", "/try", "/privacy"]);
    expect(sitemapFile(paths)).toContain("<loc>https://maneman.in/try</loc>");
  });
});
