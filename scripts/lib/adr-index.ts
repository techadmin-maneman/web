// The index of docs/decisions/, written from each record's own header so it
// cannot fall behind them (npm run adr-index; test/node/tooling/adr-index.test.ts).
//
// A record says what it changes in its header, "- Amends [0036](…)", or in its
// status, "Amends ADR 0019 …", and a record that was changed may say so in its
// own status, "Amended by ADR 0067: …". The index gathers both sides into one
// "Changed by" column, so a reader of an old record sees at once that a later
// one changed it.

import { readdirSync, readFileSync } from "node:fs";

export interface DecisionFile {
  readonly file: string;
  readonly text: string;
}

export interface Adr {
  readonly file: string;
  readonly number: string;
  readonly title: string;
  readonly date: string;
  readonly status: string;
  /** The records this one amends, supersedes, resolves or adds to. */
  readonly changes: readonly string[];
  /** The records its own status says changed it. */
  readonly changedBy: readonly string[];
}

const DIRECTORY = "docs/decisions";
const ADR_FILE = /^(\d{4})-[a-z0-9-]+\.md$/;
const ADR_NUMBER = /\b\d{4}\b/g;
/** A header clause that changes the records it names: "Amends [0027] and [0039]", "adds item 39 to [0022]". */
const CHANGING_CLAUSE = /^(amends|adds|resolves|settles|supersedes)\b/i;
/** A status's own word on who changed it: "Amended by ADR 0067", "superseded by [0050](…)". */
const CHANGED_BY = /\b(?:amended|superseded|resolved|replaced)\s+by\s+(?:ADR\s+)?\[?(\d{4})/gi;

const withoutLinks = (text: string): string => text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
const numbersIn = (text: string): string[] => [...withoutLinks(text).matchAll(ADR_NUMBER)].map((match) => match[0]);
const sorted = (numbers: Iterable<string>): string[] => [...new Set(numbers)].sort();

/** The lines above the first section: the title, the status, the date and what the record amends or follows. */
function headerLines(text: string): string[] {
  const lines = text.split("\n");
  const firstSection = lines.findIndex((line) => line.startsWith("## "));
  return lines.slice(0, firstSection === -1 ? lines.length : firstSection);
}

const field = (lines: readonly string[], name: string): string =>
  lines
    .find((line) => line.startsWith(`- ${name}:`))
    ?.slice(`- ${name}:`.length)
    .trim() ?? "";

/** "accepted (reviewers wait; see 0008). Amended …" reads as "accepted". */
function shortStatus(status: string): string {
  const plain = withoutLinks(status).replace(/\s*\([^)]*\)/g, "");
  const [first = ""] = plain.split(/\.\s|;\s/);
  return first.replace(/\.$/, "").trim();
}

function changesIn(lines: readonly string[], status: string): string[] {
  const headerClauses = lines
    .filter((line) => /^- (Amends|Resolves|Settles|Supersedes)\b/.test(line))
    .flatMap((line) => line.slice(2).split(";"))
    .map((clause) => clause.trim())
    .filter((clause) => CHANGING_CLAUSE.test(clause));
  const statusSentences = withoutLinks(status)
    .split(/\.\s/)
    .filter((sentence) => /^(amends|supersedes|resolves)\b/i.test(sentence.trim()));
  return sorted([...headerClauses, ...statusSentences].flatMap(numbersIn));
}

export function readAdr({ file, text }: DecisionFile): Adr {
  const lines = headerLines(text);
  const title = /^# (\d{4})\. (.+)$/.exec(lines[0] ?? "");
  const status = field(lines, "Status");
  return {
    file,
    number: title?.[1] ?? "",
    title: title?.[2]?.trim() ?? "",
    date: field(lines, "Date"),
    status: shortStatus(status),
    changes: changesIn(lines, status),
    changedBy: sorted([...status.matchAll(CHANGED_BY)].map((match) => match[1] ?? "")),
  };
}

/** Every ADR, and the other records beside them (the FSM trial, its licence), from docs/decisions/. */
export function readDecisions(): { adrs: DecisionFile[]; others: DecisionFile[] } {
  const files = readdirSync(DIRECTORY)
    .filter((file) => file.endsWith(".md") && file !== "README.md")
    .sort()
    .map((file) => ({ file, text: readFileSync(`${DIRECTORY}/${file}`, "utf8") }));
  return {
    adrs: files.filter(({ file }) => ADR_FILE.test(file)),
    others: files.filter(({ file }) => !ADR_FILE.test(file)),
  };
}

const link = (adr: Pick<Adr, "file" | "number">): string => `[${adr.number}](${adr.file})`;

export function adrIndex(files: readonly DecisionFile[], others: readonly DecisionFile[]): string {
  const adrs = files.map(readAdr);
  const byNumber = new Map(adrs.map((adr) => [adr.number, adr]));
  const changedBy = (adr: Adr): string =>
    sorted([
      ...adr.changedBy,
      ...adrs.filter((other) => other.changes.includes(adr.number)).map((other) => other.number),
    ])
      .filter((number) => number !== adr.number)
      .flatMap((number) => {
        const other = byNumber.get(number);
        return other === undefined ? [] : [link(other)];
      })
      .join(", ");
  const last = Math.max(0, ...adrs.map((adr) => Number(adr.number)));
  const next = String(last + 1).padStart(4, "0");
  const title = (text: string): string => /^# (.+)$/m.exec(text)?.[1]?.trim() ?? "";

  return [
    "# Architecture decision records",
    "",
    "Every decision this repository was built on, oldest first. A record says what was decided and why, and is not rewritten to say something else: a later record changes it, and says so in its own header (ADR 0001). **Changed by** gathers those later records, from either side, so an old record's reader knows to read on.",
    "",
    `This file is written by \`npm run adr-index\` from the records' own headers, and \`test/node/tooling/adr-index.test.ts\` fails until it is run after a record is added or its status changes. The next free number is ${next}.`,
    "",
    "| ADR | Decision | Date | Status | Changed by |",
    "| --- | --- | --- | --- | --- |",
    ...adrs.map((adr) => `| ${link(adr)} | ${adr.title} | ${adr.date} | ${adr.status} | ${changedBy(adr)} |`),
    "",
    // Records that are not decisions, such as a trial's findings, kept beside them; finished ones go to docs/archive/.
    ...(others.length === 0
      ? []
      : ["## Records beside them", "", ...others.map(({ file, text }) => `- [${title(text)}](${file})`), ""]),
  ].join("\n");
}
