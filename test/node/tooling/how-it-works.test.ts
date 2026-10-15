// The "how it works now" pages (docs/how-it-works/) say how each part of the business works today, so every file,
// decision and rule they name must still be there.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OPS_SETTINGS } from "../../../src/policy/ops-settings.ts";

const PAGES = readdirSync("docs/how-it-works").filter((name) => name.endsWith(".md"));
const read = (page: string) => readFileSync(`docs/how-it-works/${page}`, "utf8");
const RULES = new Set<string>(OPS_SETTINGS.map((setting) => setting.name));

/** The tables the pages name in the same way as a rule, by its snake-case name. */
const TABLES = new Set([
  "slot_times",
  "visit_blackouts",
  "city_blackouts",
  "checklist_items",
  "city_prices",
  "serviceable_pincodes",
]);

describe("the how-it-works pages", () => {
  it("name only files that are in the repository", () => {
    for (const page of PAGES) {
      for (const [, path] of read(page).matchAll(/`((?:src|scripts|migrations)\/[\w./-]+\.\w+)`/g)) {
        expect(existsSync(path ?? ""), `${page}: ${path ?? ""}`).toBe(true);
      }
    }
  });

  it("link only decisions and pages that are there", () => {
    for (const page of PAGES) {
      for (const [, link] of read(page).matchAll(/\]\(([^)#]+\.md)(?:#[^)]*)?\)/g)) {
        expect(existsSync(`docs/how-it-works/${link ?? ""}`), `${page}: ${link ?? ""}`).toBe(true);
      }
    }
  });

  it("name only rules Settings · Rules holds", () => {
    for (const page of PAGES) {
      for (const [, name] of read(page).matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)) {
        if (name === undefined || TABLES.has(name)) continue;
        expect(RULES.has(name), `${page}: ${name}`).toBe(true);
      }
    }
  });

  it("are each listed in the folder's index", () => {
    const index = read("README.md");
    for (const page of PAGES.filter((name) => name !== "README.md")) expect(index, page).toContain(`](${page})`);
  });
});
