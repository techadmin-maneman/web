// An ad account's spend report read in the browser (ADR 0288): Google's title lines and totals passed over, Meta's
// column names read too, a day read only as written unmistakably, and amounts in paise.

import { describe, expect, it } from "vitest";
import { readSpendCsv } from "../../../../apps/ops/src/spend/spend-csv.ts";

const GOOGLE = [
  "Campaign report",
  '"November 1, 2026 - November 20, 2026"',
  "Day,Campaign,Cost",
  '2026-11-19,gurgaon-search-hair-systems,"1,234.56"',
  "2026-11-20,gurgaon-search-hair-systems,0.00",
  "2026-11-20,national-brand,₹410.00",
  'Total: Account,,"1,644.56"',
  "",
].join("\r\n");

const META = [
  "Reporting starts,Reporting ends,Campaign name,Amount spent (INR)",
  '"Nov 20, 2026","Nov 20, 2026","Gurgaon | Lookalike, men 30-45",812.4',
].join("\n");

describe("an ad account's spend report", () => {
  it("reads Google's rows with spend, passing over its title lines, zero days and totals", () => {
    expect(readSpendCsv(GOOGLE)).toEqual({
      ok: true,
      rows: [
        { day: "2026-11-19", campaign: "gurgaon-search-hair-systems", amount: 123_456 },
        { day: "2026-11-20", campaign: "national-brand", amount: 41_000 },
      ],
    });
  });

  it("keeps every paisa a binary figure would lose, rounding rather than cutting", () => {
    // 19.99 × 100 is 1998.999… in a binary figure, and 0.29 × 100 is 28.999…
    const report = ["Day,Campaign,Cost", "2026-11-20,national-brand,19.99", "2026-11-20,gurgaon-search,0.29"].join(
      "\n",
    );
    expect(readSpendCsv(report)).toEqual({
      ok: true,
      rows: [
        { day: "2026-11-20", campaign: "national-brand", amount: 1999 },
        { day: "2026-11-20", campaign: "gurgaon-search", amount: 29 },
      ],
    });
  });

  it("reads Meta's column names and its spelt days, a quoted campaign's commas kept", () => {
    expect(readSpendCsv(META)).toEqual({
      ok: true,
      rows: [{ day: "2026-11-20", campaign: "Gurgaon | Lookalike, men 30-45", amount: 81_240 }],
    });
  });

  it("refuses a day a spreadsheet may have swapped, naming its line, and a file with no such columns", () => {
    expect(readSpendCsv("Day,Campaign,Cost\n20/11/2026,x,10")).toEqual({ ok: false, reason: "day", line: 2 });
    expect(readSpendCsv("Date,Clicks\n2026-11-20,4")).toEqual({ ok: false, reason: "header" });
    expect(readSpendCsv("Day,Campaign,Cost\n2026-11-20,x,0")).toEqual({ ok: false, reason: "empty" });
  });
});
