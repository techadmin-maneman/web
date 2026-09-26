// The service-area file the console takes back and hands out
// (apps/ops/src/settings/csv.ts). A file that leaves a column out must not
// switch every pincode off (FEO-03), and a list opened in a spreadsheet must
// not run anything written into it (SEC-03).

import { describe, expect, it } from "vitest";
import { readServiceAreaCsv, serviceAreaCsv } from "../../apps/ops/src/settings/csv.ts";

describe("reading the file ops upload", () => {
  it("refuses a file without all three of its columns, rather than reading a missing one as no", () => {
    expect(readServiceAreaCsv("pincode,city\n110001,Delhi")).toEqual({ ok: false, reason: "header" });
    expect(readServiceAreaCsv("pincode,served\n110001,yes")).toEqual({ ok: false, reason: "header" });
    expect(readServiceAreaCsv("pincode,launch_on\n110001,2026-10-01")).toEqual({ ok: false, reason: "header" });
  });

  it("reads yes, true and 1 as served, and no, false, 0 and a blank as not", () => {
    const file = [
      "pincode,served,launch_on",
      "110001,yes,",
      "110002,TRUE,",
      "110003,1,",
      "110004,Y,",
      "110005,no,",
      "110006,false,",
      "110007,0,",
      "110008,,",
    ].join("\n");
    const read = readServiceAreaCsv(file);
    expect(read.ok && read.rows.map((row) => [row.pincode, row.served])).toEqual([
      ["110001", true],
      ["110002", true],
      ["110003", true],
      ["110004", true],
      ["110005", false],
      ["110006", false],
      ["110007", false],
      ["110008", false],
    ]);
  });

  it("names the pincode whose served it cannot read, rather than guess", () => {
    expect(readServiceAreaCsv("pincode,served,launch_on\n110001,maybe,")).toEqual({
      ok: false,
      reason: "served",
      pincode: "110001",
    });
  });

  it("takes a launch date only as 2026-10-01, and a blank as none", () => {
    const read = readServiceAreaCsv("launch_on,pincode,served\n2026-10-01,110001,yes\n,110002,no");
    expect(read.ok && read.rows).toEqual([
      { pincode: "110001", served: true, launch_on: "2026-10-01" },
      { pincode: "110002", served: false, launch_on: null },
    ]);
    expect(readServiceAreaCsv("pincode,served,launch_on\n110001,yes,01-10-2026")).toEqual({
      ok: false,
      reason: "date",
      pincode: "110001",
    });
  });

  it("ignores every other column, the post offices with their commas included", () => {
    const read = readServiceAreaCsv(
      'pincode,city,office_names,served,launch_on\r\n110017,Delhi,"Saket SO, Malviya Nagar SO",yes,2026-09-01',
    );
    expect(read.ok && read.rows).toEqual([{ pincode: "110017", served: true, launch_on: "2026-09-01" }]);
  });
});

describe("the list ops download", () => {
  const SAKET = { pincode: "110017", area: "Saket, South", city: "Delhi", served: true, launch_on: "2026-09-01" };
  const SECTOR_65 = { pincode: "122018", area: "Sector 65", city: "Gurgaon", served: false, launch_on: null };
  const PINCODES = [SAKET, SECTOR_65];

  it("reads back as it went out", () => {
    const read = readServiceAreaCsv(serviceAreaCsv(PINCODES));
    expect(read.ok && read.rows).toEqual([
      { pincode: "110017", served: true, launch_on: "2026-09-01" },
      { pincode: "122018", served: false, launch_on: null },
    ]);
  });

  it("writes served as yes or no", () => {
    expect(serviceAreaCsv(PINCODES).split("\n").slice(1)).toEqual([
      '110017,Delhi,"Saket, South",yes,2026-09-01',
      "122018,Gurgaon,Sector 65,no,",
    ]);
  });

  it("starts any cell a spreadsheet would run as a formula with an apostrophe, so it is read as text", () => {
    for (const area of ["=HYPERLINK(1)", "+91", "-1", "@SUM(1)", "\tTab", "\rReturn"]) {
      const line = serviceAreaCsv([{ ...SECTOR_65, area }]).split("\n")[1] ?? "";
      expect(line, JSON.stringify(area)).not.toMatch(/,"?[=+\-@\t\r]/);
      expect(line, JSON.stringify(area)).toContain(`'${area}`);
    }
  });

  it("doubles a quote inside a quoted cell", () => {
    const line = serviceAreaCsv([{ ...SECTOR_65, area: 'Ram "Nagar", East' }]).split("\n")[1];
    expect(line).toBe('122018,Gurgaon,"Ram ""Nagar"", East",no,');
  });
});
