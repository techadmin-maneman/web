// Consents are written by recordConsent alone, so a rule such as "never override a decision" lives in one place.
// This holds the source to it: a raw insert anywhere else fails here.

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function sourceFiles(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = `${folder}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

/** An insert into consents in any spelling SQL takes: any case, any spacing, and INSERT OR IGNORE and the like. */
const CONSENT_INSERT = /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+consents\s*\(([^)]*)\)/gi;

/** Each statement in src/ that writes a consent, by its file, with the columns it names. */
function consentWrites(): { file: string; columns: string[] }[] {
  return sourceFiles("src").flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(CONSENT_INSERT)].map((match) => ({
      file,
      columns: (match[1] ?? "").split(",").map((column) => column.trim().toLowerCase()),
    })),
  );
}

describe("the statements that write a consent", () => {
  it("are one, in recordConsent's module", () => {
    expect(consentWrites().map((write) => write.file)).toEqual(["src/domain/consents.ts"]);
  });

  it("are found however the statement is spelt", () => {
    const spellings = [
      "INSERT INTO consents (id, source)",
      "insert or ignore into consents(id, source)",
      "INSERT OR REPLACE\n  INTO consents (id, source)",
    ];
    expect(spellings.flatMap((sql) => [...sql.matchAll(CONSENT_INSERT)])).toHaveLength(3);
  });

  it("name where the consent was given", () => {
    const withoutSource = consentWrites().filter((write) => !write.columns.includes("source"));
    expect(withoutSource).toEqual([]);
  });
});
