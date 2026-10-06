// A client's health history stays in our database (docs/decisions/0106-a-clients-hair-profile.md; ADR 0025, item
// 98): it never reaches Zoho CRM, FSM or Books, a log line or the audit log. The table it is kept in is named by the
// files below and no others, so no queue, provider or sync can read it without failing here first.

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function sourceFiles(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = `${folder}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

const naming = (pattern: RegExp) => sourceFiles("src").filter((file) => pattern.test(readFileSync(file, "utf8")));

describe("the hair profile's table", () => {
  it("is read and written in its own domain file alone", () => {
    // The audit log names it too, only to write a correction's entry once its row is there, and the map of personal
    // data, to say what the export and the erasure do with it. Neither reads a column of it.
    expect(naming(/\bhair_profiles\b/).sort()).toEqual(
      ["src/domain/ops/audit.ts", "src/domain/clients/hair-profiles.ts", "src/policy/personal-data.ts"].sort(),
    );
  });

  it("is reached through it by the routes, the card, the erasure and the export, and by no queue or provider", () => {
    // Imported from beside it or from any folder: "./hair-profiles.ts", "../clients/hair-profiles.ts".
    const users = naming(/from "(?:\.\.?\/)+(?:domain\/)?(?:[a-z-]+\/)?hair-profiles\.ts"/).sort();
    expect(users).toEqual(
      [
        "src/domain/privacy/data-export.ts",
        "src/domain/privacy/erasure-statements.ts",
        "src/domain/field/job-card.ts",
        "src/routes/ops/hair-profile.ts",
        "src/routes/tech/jobs.steps.ts",
      ].sort(),
    );
  });
});
