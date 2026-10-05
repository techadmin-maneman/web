// The tables whose writes once drifted between modules, each written by the modules listed here alone. A new writer
// is a new place every rule on the table has to be remembered, so it is added here on purpose, or the write goes
// through the table's owner: src/domain/people.ts, src/domain/queued-messages.ts, src/domain/credits.ts.

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const WRITERS: Readonly<Record<string, readonly string[]>> = {
  people: ["src/domain/form-person.ts", "src/domain/people.ts"],
  outbound_messages: [
    "src/domain/payment-links.ts",
    "src/domain/queued-messages.ts",
    "src/domain/referral-grants.ts",
    "src/domain/ruling-claims.ts",
    "src/domain/tryon-claims.ts",
    "src/domain/visit-messages.ts",
    "src/domain/waitlist.ts",
  ],
  credit_ledger: [
    "src/domain/credits.ts",
    "src/domain/referral-grants.ts",
    "src/domain/ruling-claims.ts",
    "src/domain/visit-changes.ts",
  ],
};

function sourceFiles(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = `${folder}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

/** The files in src/ that insert into `table`, in SQL or through insertRow. */
function writersOf(table: string): string[] {
  const writes = new RegExp(
    `INSERT\\s+(?:OR\\s+\\w+\\s+)?INTO\\s+${table}\\b|insertRow\\(\\s*\\w+,\\s*"${table}"`,
    "i",
  );
  return sourceFiles("src")
    .filter((file) => writes.test(readFileSync(file, "utf8")))
    .sort((a, b) => a.localeCompare(b));
}

describe("the tables written in one place", () => {
  it.each(Object.entries(WRITERS))("%s is written only by its listed modules", (table, files) => {
    expect(writersOf(table)).toEqual(files);
  });
});
