// The tables whose writes once drifted between modules, each written by the modules listed here alone. A new writer
// is a new place every rule on the table has to be remembered, so it is added here on purpose, or the write goes
// through the table's owner: src/domain/clients/people.ts, src/domain/messages/queued-messages.ts, src/domain/money/credits.ts.

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const WRITERS: Readonly<Record<string, readonly string[]>> = {
  people: ["src/domain/booking/form-person.ts", "src/domain/clients/people.ts"],
  outbound_messages: [
    "src/domain/money/payment-links.ts",
    "src/domain/messages/queued-messages.ts",
    "src/domain/referrals/referral-grants.ts",
    "src/domain/no-shows/ruling-claims.ts",
    "src/domain/try-on/tryon-claims.ts",
    "src/domain/messages/visit-messages.ts",
    "src/domain/booking/waitlist.ts",
  ],
  credit_ledger: [
    "src/domain/money/credits.ts",
    "src/domain/referrals/referral-grants.ts",
    "src/domain/no-shows/ruling-claims.ts",
    "src/domain/visits/visit-cancel.ts",
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
    expect(writersOf(table)).toEqual([...files].sort((a, b) => a.localeCompare(b)));
  });
});
