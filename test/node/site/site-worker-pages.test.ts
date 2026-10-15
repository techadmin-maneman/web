// Every page the site builds goes through its Worker first (run_worker_first in site/wrangler.jsonc), which gives the
// page's policy a nonce of the request's own (docs/decisions/0206-trusted-types-and-a-nonce-per-page.md). The 404 is
// the assets' own answer to an address no page has.

import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readJsonc } from "../../../scripts/lib/jsonc.ts";

function pagesUnder(folder: string, path = ""): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return pagesUnder(`${folder}/${entry.name}`, `${path}/${entry.name}`);
    if (!entry.name.endsWith(".astro") || entry.name === "404.astro") return [];
    const name = entry.name.slice(0, -".astro".length);
    if (name === "index") return [path === "" ? "/" : path];
    return [`${path}/${name.startsWith("[") ? "*" : name}`];
  });
}

describe("the site's pages", () => {
  it("each go through the Worker, in every environment", () => {
    type Assets = { assets: { run_worker_first: string[] } };
    const config = readJsonc("site/wrangler.jsonc") as Assets & { env: Record<string, Assets> };
    const pages = pagesUnder("site/src/pages");
    expect(pages).toEqual(expect.arrayContaining(["/", "/book", "/areas/*", "/r"]));
    for (const assets of [config, ...Object.values(config.env)].map((each) => each.assets)) {
      expect(assets.run_worker_first).toEqual(expect.arrayContaining(pages));
    }
  });
});
