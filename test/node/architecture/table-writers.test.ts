// Each core table has one owner, the folder or module every write to it goes through (docs/architecture.md). A write
// anywhere else is one more place every rule on the table has to be remembered: those there are today are listed in
// ./table-writers-baseline.ts, a new one fails here, and one gone must come off the list, so it only shrinks.

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WRITTEN_ELSEWHERE } from "./table-writers-baseline.ts";

/** Who writes each core table: a folder, ending in "/", or one module. */
const OWNERS = {
  appointments: "src/domain/visits/",
  visit_outcomes: "src/domain/visits/",
  slot_holds: "src/domain/booking/",
  slot_claims: "src/domain/booking/",
  credit_ledger: "src/domain/money/credits.ts",
  payments: "src/domain/money/",
  outbound_messages: "src/domain/messages/",
  people: "src/domain/clients/",
  technicians: "src/domain/dispatch/",
} as const;

export type CoreTable = keyof typeof OWNERS;

function sourceFiles(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = `${folder}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

const SOURCES = sourceFiles("src").map((file) => ({ file, text: readFileSync(file, "utf8") }));

/** The files in src/ that insert into, update or delete from `table`, in SQL or through insertRow. */
function writersOf(table: string): string[] {
  const writes = new RegExp(
    `(?:INSERT\\s+(?:OR\\s+\\w+\\s+)?INTO|REPLACE\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+${table}\\b|insertRow\\(\\s*\\w+,\\s*"${table}"`,
  );
  return SOURCES.filter(({ text }) => writes.test(text))
    .map(({ file }) => file)
    .sort((a, b) => a.localeCompare(b));
}

const owns = (owner: string, file: string): boolean => (owner.endsWith("/") ? file.startsWith(owner) : file === owner);

describe("the core tables", () => {
  it.each(Object.entries(OWNERS))("%s is written by %s, and elsewhere only where the baseline says", (table, owner) => {
    const elsewhere = writersOf(table).filter((file) => !owns(owner, file));
    expect(elsewhere).toEqual([...(WRITTEN_ELSEWHERE[table as CoreTable] ?? [])].sort((a, b) => a.localeCompare(b)));
  });

  it("are each written by their owner", () => {
    for (const [table, owner] of Object.entries(OWNERS)) {
      expect(writersOf(table).some((file) => owns(owner, file))).toBe(true);
    }
  });
});
