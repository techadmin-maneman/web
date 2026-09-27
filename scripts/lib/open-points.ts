// docs/open-points.md is read by people deciding whether production can go
// out, so its numbers have to mean one thing each. The rules, checked by
// scripts/check-open-points.ts and test/node/open-points.test.ts:
//
// - every point has a number of its own, and a number is never reused;
// - an open table holds only what is still owed: a point that is settled,
//   done or closed, or that owes nothing before production, moves to
//   "Settled", keeping its number;
// - a point the file cites ("item 44") exists, and so does one cited from
//   anywhere else ("docs/open-points.md, item 44", "open point 44").
//
// Applied migrations cite the numbers from before 27 September 2026 and can
// never be edited, so they are not read; the file maps the old numbers.

import { execFileSync } from "node:child_process";

export interface OpenPoint {
  readonly number: number;
  readonly title: string;
  readonly settled: boolean;
  readonly line: number;
}

export interface CitedPoint {
  readonly number: number;
  /** Where the number starts in the text. */
  readonly index: number;
}

const SETTLED_HEADING = "## Settled";
const TABLE_ROW = /^\|\s*(\d+)\s*\|/;
const SETTLED_ENTRY = /^- \*\*(\d+)\. (.+?)\.?\*\*/;
const SAYS_SETTLED = /^(\*\*)?(settled|done|closed)\b/i;
const OWES_NOTHING = /^(\*\*)?nothing\b/i;

// "44", "2 and 3", "66, 67 and 68", "86 to 94"
const NUMBERS = String.raw`\d+(?:(?:,\s*|\s+and\s+|\s+to\s+)\d+)*`;
const CITES = [
  // docs/open-points.md, item 96 / `docs/open-points.md`, items 86 to 94 / docs/open-points.md, 42 /
  // docs/open-points.md item 13 / `docs/open-points.md`'s item 27
  new RegExp(String.raw`open-points\.md\x60?(?:'s)?(?:,\s+(?:items?\s+)?|\s+items?\s+)(${NUMBERS})`, "gi"),
  // open point 44 / open points 66, 67 and 68
  new RegExp(String.raw`\bopen[- ]points?\s+(?:items?\s+)?(${NUMBERS})`, "gi"),
  // item 58 of docs/open-points.md
  new RegExp(String.raw`\bitems?\s+(${NUMBERS})\s+of\s+\x60?docs/open-points\.md`, "gi"),
];
// Inside the file itself, "item 44"; but "ADR 0025, item 44" is the register's.
const ITEM_HERE = new RegExp(String.raw`(ADR\s+\d{4},\s+)?\bitems?\s+(${NUMBERS})`, "gi");

/** The numbers in "66, 67 and 68" or "86 to 94", each with where it stands in `text`. */
function numbersIn(list: string, at: number): CitedPoint[] {
  const found = [...list.matchAll(/\d+/g)].map((match) => ({
    number: Number(match[0]),
    index: at + match.index,
  }));
  const range = /^(\d+)\s+to\s+(\d+)$/.exec(list);
  if (range === null) return found;
  const [first, last] = found;
  if (first === undefined || last === undefined) return found;
  const between = Array.from({ length: last.number - first.number - 1 }, (_, step) => ({
    number: first.number + step + 1,
    index: first.index,
  }));
  return [first, ...between, last];
}

/** The part of the file before the settled list holds the open tables; after the list comes nothing that is a point. */
function sectionsOf(markdown: string): { lines: string[]; settledFrom: number; settledTo: number } {
  const lines = markdown.split("\n");
  const settledFrom = lines.findIndex((line) => line.trim() === SETTLED_HEADING);
  const next = lines.findIndex((line, index) => index > settledFrom && line.startsWith("## "));
  return {
    lines,
    settledFrom: settledFrom === -1 ? lines.length : settledFrom,
    settledTo: settledFrom === -1 || next === -1 ? lines.length : next,
  };
}

const cellsOf = (row: string): string[] =>
  row
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());

const plainTitle = (title: string): string => title.replaceAll("**", "").trim();

export function readOpenPoints(markdown: string): OpenPoint[] {
  const { lines, settledFrom, settledTo } = sectionsOf(markdown);
  const points: OpenPoint[] = [];
  lines.forEach((line, index) => {
    if (index < settledFrom) {
      const row = TABLE_ROW.exec(line);
      const [, title = ""] = cellsOf(line);
      if (row !== null)
        points.push({ number: Number(row[1]), title: plainTitle(title), settled: false, line: index + 1 });
      return;
    }
    if (index >= settledTo) return;
    const entry = SETTLED_ENTRY.exec(line);
    if (entry !== null)
      points.push({ number: Number(entry[1]), title: plainTitle(entry[2] ?? ""), settled: true, line: index + 1 });
  });
  return points;
}

export const nextFreeNumber = (points: readonly OpenPoint[]): number =>
  Math.max(0, ...points.map((point) => point.number)) + 1;

/** Why a row in an open table reads as settled, or null if it is still owed. */
function whySettled(cells: readonly string[], header: readonly string[]): string | null {
  const owed = cells.slice(2);
  for (const [offset, cell] of owed.entries()) {
    if (SAYS_SETTLED.test(cell)) return `its "${header[offset + 2] ?? ""}" says it is settled`;
  }
  const last = owed.at(-1) ?? "";
  if (OWES_NOTHING.test(last)) return `its "${header.at(-1) ?? ""}" says nothing is owed`;
  return null;
}

function settledRowProblems(lines: readonly string[], settledFrom: number): string[] {
  const problems: string[] = [];
  let header: string[] = [];
  for (const line of lines.slice(0, settledFrom)) {
    if (line.startsWith("| #")) header = cellsOf(line);
    if (!TABLE_ROW.test(line)) continue;
    const cells = cellsOf(line);
    const why = whySettled(cells, header);
    if (why !== null)
      problems.push(
        `${cells[0] ?? ""} (${plainTitle(cells[1] ?? "")}) is in an open table, but ${why}: move it to Settled`,
      );
  }
  return problems;
}

function duplicateProblems(points: readonly OpenPoint[]): string[] {
  const problems: string[] = [];
  points.forEach((point, index) => {
    const first = points.findIndex((other) => other.number === point.number);
    if (first === index) return;
    const earlier = points[first];
    if (earlier === undefined) return;
    problems.push(
      `${String(point.number)} is used twice: ${earlier.title} (line ${String(earlier.line)}) and ${point.title} (line ${String(point.line)})`,
    );
  });
  return problems;
}

function citedHereProblems(lines: readonly string[], settledTo: number, numbers: ReadonlySet<number>): string[] {
  const problems: string[] = [];
  lines.slice(0, settledTo).forEach((line, index) => {
    for (const match of line.matchAll(ITEM_HERE)) {
      if (match[1] !== undefined) continue;
      for (const { number } of numbersIn(match[2] ?? "", 0)) {
        if (!numbers.has(number))
          problems.push(`line ${String(index + 1)} cites item ${String(number)}, which is no point here`);
      }
    }
  });
  return problems;
}

export function openPointProblems(markdown: string): string[] {
  const { lines, settledFrom, settledTo } = sectionsOf(markdown);
  const points = readOpenPoints(markdown);
  const numbers = new Set(points.map((point) => point.number));
  return [
    ...duplicateProblems(points),
    ...settledRowProblems(lines, settledFrom),
    ...citedHereProblems(lines, settledTo, numbers),
  ];
}

/** Every open point `text` cites by number, in order, with where each number stands. */
export function citedPoints(text: string): CitedPoint[] {
  const cites = CITES.flatMap((pattern) =>
    [...text.matchAll(pattern)].flatMap((match) => {
      const list = match[1] ?? "";
      return numbersIn(list, match.index + match[0].lastIndexOf(list));
    }),
  );
  return cites.sort((a, b) => a.index - b.index);
}

export function referenceProblems(
  files: readonly { path: string; text: string }[],
  numbers: ReadonlySet<number>,
): string[] {
  return files.flatMap(({ path, text }) =>
    citedPoints(text)
      .filter((cite) => !numbers.has(cite.number))
      .map((cite) => {
        const line = text.slice(0, cite.index).split("\n").length;
        return `${path}:${String(line)} cites open point ${String(cite.number)}, which is not in docs/open-points.md`;
      }),
  );
}

/** What is not read: the file itself, the owner's prompts and designs, applied migrations, and this check. */
const NOT_READ = [
  /^docs\/open-points\.md$/,
  /^docs\/prompts\//,
  /^design\//,
  /^migrations\//,
  /^scripts\/lib\/open-points\.ts$/,
  /^test\/node\/open-points\.test\.ts$/,
  /^package-lock\.json$/,
];
const TEXT_FILE = /\.(md|ts|tsx|astro|js|mjs|json|jsonc|ya?ml|css|html|txt)$/;

/** Every tracked text file that might cite an open point. */
export function citingFiles(): string[] {
  return execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split("\n")
    .filter((path) => TEXT_FILE.test(path) && !NOT_READ.some((pattern) => pattern.test(path)));
}
