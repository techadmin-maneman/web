// docs/settings.md answers "what decides X in production?" from one page, so it is held to where each setting lives.

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DATED_TABLE_NAMES, settingsDoc } from "../../../scripts/lib/settings-doc.ts";

describe("the settings page", () => {
  it("is as npm run settings writes it from where each setting lives", () => {
    expect(readFileSync("docs/settings.md", "utf8")).toBe(settingsDoc());
  });

  it("names only tables the migrations make", () => {
    const sql = readdirSync("migrations")
      .filter((name) => name.endsWith(".sql"))
      .map((name) => readFileSync(`migrations/${name}`, "utf8"))
      .join("\n");
    for (const table of DATED_TABLE_NAMES) expect(sql, table).toContain(`CREATE TABLE ${table} `);
  });

  it("names every secret, and none of their values", () => {
    const page = settingsDoc();
    expect(page).toContain("- `RAZORPAY_KEY_SECRET`");
    expect(page).toContain("- `YOUCAM_API_KEY`");
    expect(page).not.toMatch(/rzp_live_/);
  });
});
