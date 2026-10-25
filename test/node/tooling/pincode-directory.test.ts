// India Post's directory (scripts/lib/pincode-directory.ts, ADR 0220): offices folded into one row a pincode, the file
// the repository keeps, and the SQL that loads it; and the name an area takes from it (src/policy/area-names.ts).

import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  directoryCsv,
  directoryInserts,
  pincodesOf,
  readDirectoryCsv,
  type Office,
} from "../../../scripts/lib/pincode-directory.ts";
import { AREA_NAME, fittedArea } from "../../../src/policy/area-names.ts";

const office = (pincode: string, officename: string, delivery: string, latitude = "", longitude = ""): Office => ({
  officename,
  pincode,
  delivery,
  district: " Mumbai  Suburban ",
  statename: "Maharashtra",
  latitude,
  longitude,
});

describe("folding the directory's offices", () => {
  it("takes the delivering office's district, state and point, and every office's name once", () => {
    const [bandra] = pincodesOf([
      office("400050", "Pali Hill BO", "Non-Delivery", "19.07", "72.82"),
      office("400050", "Bandra West SO", "Delivery", "19.06", "72.83"),
      office("400050", "Pali  Hill BO", "Non-Delivery"),
    ]);
    expect(bandra).toEqual({
      pincode: "400050",
      district: "MUMBAI SUBURBAN",
      state: "MAHARASHTRA",
      officeNames: "Bandra West SO;Pali Hill BO",
      latitude: 19.06,
      longitude: 72.83,
    });
  });

  it("falls back to the middle of the offices' points, and drops a point outside India and a broken pincode", () => {
    const rows = pincodesOf([
      office("400051", "Kherwadi SO", "Delivery", "0", "0"),
      office("400051", "Bandra East SO", "Non-Delivery", "19.06", "72.84"),
      office("40005", "Nowhere SO", "Delivery"),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ latitude: 19.06, longitude: 72.84 });
  });

  it("writes the file and reads it back unchanged", () => {
    const rows = pincodesOf([
      office("400050", "Bandra West SO", "Delivery", "19.06", "72.83"),
      office("411001", 'Pune "City" HO, East', "Delivery"),
    ]);
    const back = readDirectoryCsv(directoryCsv(rows));
    expect(back).toEqual(rows.map((row) => ({ ...row, officeNames: row.officeNames.replaceAll('"', "'") })));
  });

  it("refuses a file without its columns, or a line with no district", () => {
    expect(() => readDirectoryCsv("pincode,district\n400050,MUMBAI")).toThrow(/no state/);
    expect(() =>
      readDirectoryCsv("pincode,district,state,office_names,latitude,longitude\n400050,,MAHARASHTRA,,,"),
    ).toThrow(/line 2/);
  });

  it("loads as SQL that replaces a pincode's row, a statement for each hundred", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(readFileSync("migrations/0196_pincode_directory.sql", "utf8"));
    const rows = pincodesOf([
      office("400050", "Bandra West SO", "Delivery", "19.06", "72.83"),
      office("400051", "Kherwadi SO", "Delivery"),
    ]);
    const twice = [...directoryInserts(rows, "2025-10-03", 1), ...directoryInserts(rows, "2026-01-03")];
    expect(twice).toHaveLength(3);
    for (const statement of twice) db.exec(statement);
    expect(db.prepare("SELECT pincode, latitude, refreshed_on FROM pincode_directory ORDER BY pincode").all()).toEqual([
      { pincode: "400050", latitude: 19.06, refreshed_on: "2026-01-03" },
      { pincode: "400051", latitude: null, refreshed_on: "2026-01-03" },
    ]);
  });

  it("keeps a file every row of which loads", () => {
    const rows = readDirectoryCsv(readFileSync("data/pincodes/india-pincodes.csv", "utf8"));
    expect(rows.length).toBeGreaterThan(19_000);
    expect(new Set(rows.map((row) => row.pincode)).size).toBe(rows.length);
    expect(readFileSync("data/pincodes/india-pincodes.date", "utf8").trim()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("an area's suggested name", () => {
  it("is fitted to the names ops may give, else the fallback's, else Area", () => {
    expect(fittedArea("Bandra West", "Mumbai")).toBe("Bandra West");
    expect(fittedArea("K.K. Nagar [West]", "Chennai")).toBe("K.K. Nagar West");
    expect(fittedArea("=", "Chennai")).toBe("Chennai");
    expect(fittedArea("*", "?")).toBe("Area");
    expect(AREA_NAME.test(fittedArea("A very long post office name that runs past forty characters", "x"))).toBe(true);
  });
});
