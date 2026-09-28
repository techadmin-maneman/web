// Every consent keeps where it was given (docs/decisions/0094-where-a-consent-was-given.md). The functions that
// write one take a ConsentSource, so a caller that leaves it out does not compile; this holds the statements
// themselves to it, so a new writer that forgets the column fails here.

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function sourceFiles(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = `${folder}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

/** Each statement in src/ that writes a consent, by its file, with the columns it names. */
function consentWrites(): { file: string; columns: string[] }[] {
  return sourceFiles("src").flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/INSERT INTO consents\s*\(([^)]*)\)/g)].map((match) => ({
      file,
      columns: (match[1] ?? "").split(",").map((column) => column.trim()),
    })),
  );
}

describe("the statements that write a consent", () => {
  it("are found, in every file that writes one", () => {
    const files = new Set(consentWrites().map((write) => write.file));
    expect([...files].sort()).toEqual([
      "src/domain/erasure.ts",
      "src/domain/leads.ts",
      "src/domain/profile.ts",
      "src/domain/public-booking.ts",
      "src/domain/tryon-claims.ts",
    ]);
  });

  it("each name where the consent was given", () => {
    const withoutSource = consentWrites().filter((write) => !write.columns.includes("source"));
    expect(withoutSource).toEqual([]);
  });
});
