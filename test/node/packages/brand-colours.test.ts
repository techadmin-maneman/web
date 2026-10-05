// The brand's colours drawn outside a stylesheet -- the apps' icons and
// manifests, the site's card images, the house referral card, Razorpay's
// window, each page's theme colour -- are read from tokens.css, never written
// again as a hex value that the token tests cannot see (the referral
// card's gold once slipped through that gap).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { colourOf } from "../../../packages/brand/colours.ts";
import { themeColor } from "../../../packages/web-kit/pwa.ts";

const TOKENS = readFileSync("packages/brand/tokens.css", "utf8");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name).replace(/\\/g, "/");
    if (["node_modules", "dist", ".astro"].includes(name) || name.endsWith("api-schema.ts")) return [];
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe("a colour drawn outside a stylesheet", () => {
  it("is read from tokens.css by its name", () => {
    expect(colourOf("--ink", TOKENS)).toBe("#16233a");
    expect(colourOf("--ink-deep", TOKENS)).toBe("#0e1728");
    expect(() => colourOf("--no-such-colour", TOKENS)).toThrow();
  });

  it("is never written as a hex value in the front ends' code", () => {
    const code = [
      ...["apps/app", "apps/ops", "apps/tech"].flatMap((app) => files(app)),
      ...files("site/src"),
      ...files("packages/ui"),
      ...files("packages/web-kit"),
      "scripts/build/make-house-card.ts",
    ].filter((path) => /\.(ts|tsx)$/.test(path));
    const written = code.filter((path) => /#[0-9a-fA-F]{6}\b/.test(readFileSync(path, "utf8")));
    expect(written).toEqual([]);
  });
});

// A page's head names its theme colour's token, and the build writes in the value (packages/web-kit/pwa.ts).
describe("each app's theme colour", () => {
  it.each([
    ["apps/app/index.html", "--ink"],
    ["apps/ops/index.html", "--ink"],
    ["apps/tech/index.html", "--ink-deep"],
  ])("%s is its ground, %s", (page, ground) => {
    const html = readFileSync(page, "utf8");
    expect(/<meta name="theme-color" content="(--[\w-]+)"/.exec(html)?.[1]).toBe(ground);
    expect(themeColor().transformIndexHtml).toBeTypeOf("function");
    const built = (themeColor().transformIndexHtml as (html: string) => string)(html);
    expect(built).toContain(`<meta name="theme-color" content="${colourOf(ground, TOKENS)}" />`);
  });
});
