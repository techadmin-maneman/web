import { describe, expect, it } from "vitest";
import {
  citedPoints,
  nextFreeNumber,
  openPointProblems,
  readOpenPoints,
  referenceProblems,
} from "../../../scripts/lib/open-points.ts";

const table = (heading: string, ...rows: string[]) =>
  [
    `## ${heading}`,
    "",
    "| #   | Point | Staging uses | Before production |",
    "| --- | ----- | ------------ | ----------------- |",
    ...rows,
    "",
  ].join("\n");

const settled = (...entries: string[]) => ["## Settled", "", ...entries, ""].join("\n");

describe("reading the open points", () => {
  it("reads each table row and each settled entry, with its number and title", () => {
    const markdown = [
      table("Money", "| 1   | The price book | The design's figures | The owner's |"),
      settled("- **2. Bot Fight Mode is off.** 22 September 2026.", "  - a line beneath it"),
    ].join("\n");
    expect(readOpenPoints(markdown)).toEqual([
      { number: 1, title: "The price book", settled: false, line: 5 },
      { number: 2, title: "Bot Fight Mode is off", settled: true, line: 9 },
    ]);
  });

  it("takes the next free number after the highest", () => {
    const markdown = [table("Money", "| 3   | A | b | c |"), settled("- **7. D.** e.")].join("\n");
    expect(nextFreeNumber(readOpenPoints(markdown))).toBe(8);
  });
});

describe("the open points' own problems", () => {
  it("names a number used twice", () => {
    const markdown = [table("Money", "| 4   | A | b | c |"), settled("- **4. D.** e.")].join("\n");
    expect(openPointProblems(markdown)).toEqual(["4 is used twice: A (line 5) and D (line 9)"]);
  });

  it.each([
    ["| 5   | A | **Settled 24 September 2026:** the owner ruled | c |", '"Staging uses" says it is settled'],
    ["| 5   | A | b | **Settled.** Nothing more |", '"Before production" says it is settled'],
    ["| 5   | A | **Done.** Built | c |", '"Staging uses" says it is settled'],
    ["| 5   | A | **Closed at ₹0.** Nil | c |", '"Staging uses" says it is settled'],
    ["| 5   | A | b | Nothing. The rest is optional |", '"Before production" says nothing is owed'],
  ])("finds a settled row still in an open table: %s", (row, why) => {
    expect(openPointProblems(table("Money", row))).toEqual([
      `5 (A) is in an open table, but its ${why}: move it to Settled`,
    ]);
  });

  it("lets a staging cell say nothing is used there yet", () => {
    expect(openPointProblems(table("Zoho", "| 6   | A | Nothing. Every person is a lead | The owner rules |"))).toEqual(
      [],
    );
  });

  it("names a point the file cites that is not there, and reads a register's item as the register's", () => {
    const markdown = table("Money", "| 1   | A | See item 9, and ADR 0025, item 44 | Items 1 and 12 |");
    expect(openPointProblems(markdown)).toEqual([
      "line 5 cites item 9, which is no point here",
      "line 5 cites item 12, which is no point here",
    ]);
  });

  it("ignores what follows the settled list, such as the old numbers' map", () => {
    const markdown = [
      table("Money", "| 1   | A | b | c |"),
      settled("- **2. B.** c."),
      "## Numbers before 27 September 2026",
      "",
      "| 9 | 1 |",
    ].join("\n");
    expect(openPointProblems(markdown)).toEqual([]);
    expect(readOpenPoints(markdown).map((point) => point.number)).toEqual([1, 2]);
  });
});

describe("citing an open point from another file", () => {
  it.each([
    ["(`docs/open-points.md`, item 96)", [96]],
    ["docs/open-points.md, items 86 to 94", [86, 87, 88, 89, 90, 91, 92, 93, 94]],
    ["(docs/open-points.md, 42)", [42]],
    ["open point 44 already said so", [44]],
    ["open points 66, 67 and 68", [66, 67, 68]],
    ["Open point 12", [12]],
    ["item 58 of docs/open-points.md", [58]],
    ["(item 59 of `docs/open-points.md`)", [59]],
    ["`docs/open-points.md`, items 2 and 3", [2, 3]],
    ["docs/open-points.md item 13", [13]],
    ["it is `docs/open-points.md`'s item 27", [27]],
  ])("reads %s", (text, numbers) => {
    expect(citedPoints(text).map((cite) => cite.number)).toEqual(numbers);
  });

  it.each([
    "ADR 0025, item 44",
    'docs/open-points.md, "Board D3\'s jobs"',
    "open points move but do not close",
    "provisioning, step 11b, 6",
  ])("reads nothing in %s", (text) => {
    expect(citedPoints(text)).toEqual([]);
  });

  it("gives where each number stands, so a number can be changed in place", () => {
    const text = "see open points 66 and 67";
    expect(citedPoints(text)).toEqual([
      { number: 66, index: text.indexOf("66") },
      { number: 67, index: text.indexOf("67") },
    ]);
  });

  it("names the file, the line and the number that is no point", () => {
    const files = [{ path: "docs/x.md", text: "one\nsee open point 12\nand open point 3" }];
    expect(referenceProblems(files, new Set([3]))).toEqual([
      "docs/x.md:2 cites open point 12, which is not in docs/open-points.md",
    ]);
  });
});
