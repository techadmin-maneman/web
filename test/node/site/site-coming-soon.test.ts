// What maneman.in serves until the site goes live there (PRODUCTION_LIVE, site/src/lib/flags.ts): the coming-soon
// page, built where production's assets are, with the site's headers, never indexed, and carrying the try-on's
// reference photographs. Going live is the switch alone.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildComingSoon } from "../../../scripts/build/coming-soon.ts";
import { readJsonc } from "../../../scripts/lib/jsonc.ts";
import { WHATSAPP_NUMBER } from "../../../packages/web-kit/whatsapp.ts";
import { PRODUCTION_LIVE } from "../../../site/src/lib/flags.ts";

const out = mkdtempSync(join(tmpdir(), "coming-soon-"));
buildComingSoon(out);
const read = (path: string) => readFileSync(join(out, path), "utf8");

afterAll(() => {
  rmSync(out, { recursive: true, force: true });
});

describe("production's coming-soon page", () => {
  // The placeholder it served was bare, indexable, and sent no headers of its own.
  it("is never indexed, and says it is mm-site's production page, as the smoke check reads it", () => {
    for (const page of ["index.html", "404.html"]) {
      expect(read(page), page).toContain('<meta name="robots" content="noindex, nofollow" />');
      expect(read(page), page).toContain('<meta name="mm-worker" content="mm-site" />');
      expect(read(page), page).toContain('<meta name="mm-environment" content="production" />');
    }
    expect(read("robots.txt")).toBe("User-agent: *\nDisallow: /\n");
  });

  it("carries the site's security headers, its noindex among them", () => {
    const headers = read("_headers");
    expect(headers).toMatch(/Content-Security-Policy: default-src 'self';.*frame-ancestors 'none'/);
    expect(headers).toContain("Strict-Transport-Security: max-age=63072000; includeSubDomains");
    expect(headers).toContain("X-Content-Type-Options: nosniff");
    expect(headers).toContain("X-Robots-Tag: noindex, nofollow");
  });

  it("offers WhatsApp to be told when it opens, and no style or script the policy would refuse", () => {
    const page = read("index.html");
    expect(page).toContain(`href="https://wa.me/${WHATSAPP_NUMBER.replace(/\D/g, "")}?text=`);
    expect(page).not.toMatch(/<script|<style|style=/);
  });

  // Staging's try-on asks YouCam to fetch them from production's host.
  it("serves the try-on's reference photographs as the site's public files hold them", () => {
    const file = "refs/v1/quiff.jpg";
    expect(readFileSync(join(out, file)).equals(readFileSync(`site/public/${file}`))).toBe(true);
  });
});

describe("going live in production", () => {
  it("is not yet switched on", () => {
    expect(PRODUCTION_LIVE).toBe(false);
  });

  // Going live was two hand edits: the assets folder here, and a build step in the release.
  it("needs no edit beyond the switch: production's assets are its build, which the release makes", () => {
    type Assets = { assets: { directory: string } };
    const config = readJsonc("site/wrangler.jsonc") as Assets & { env: Record<string, Assets> };
    expect(config.env.production?.assets.directory).toBe("./dist/production");

    const release = readFileSync(".github/workflows/deploy-production.yml", "utf8");
    const build = release.indexOf("npm run build:site -- --env production");
    expect(build).toBeGreaterThan(-1);
    expect(build).toBeLessThan(release.indexOf("--worker mm-site --env production --tag"));
  });
});
