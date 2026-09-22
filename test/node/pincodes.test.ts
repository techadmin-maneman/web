// Reading the pincode list (scripts/lib/pincodes.ts): each pincode's area, from its post offices.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { areaOf, fields } from "../../scripts/lib/pincodes.ts";

describe("the pincode list", () => {
  it("names an area by its shortest sub or head office, without the office's suffix", () => {
    expect(areaOf("Distt Court Complex Saket SO;Malviya Nagar SO South Delhi;Saket SO South Delhi", "Delhi")).toBe(
      "Saket",
    );
    expect(areaOf("D Block South City II Gurgaon;Gurgaon South City II SO", "Gurgaon")).toBe("Gurgaon South City II");
    expect(areaOf("Noida HO;Sec 16 Noida SO", "Noida")).toBe("Noida");
    expect(areaOf("CAT EXTENSION COUNTER", "Delhi")).toBe("Delhi");
  });

  it("reads every row of the list, each a six-digit pincode with a city and an area", () => {
    const [header = "", ...lines] = readFileSync("data/pincodes/ncr-pincodes.csv", "utf8").trim().split(/\r?\n/);
    const columns = fields(header);
    expect(lines).toHaveLength(198);
    for (const line of lines) {
      const row = fields(line);
      expect(row).toHaveLength(columns.length);
      expect(row[columns.indexOf("pincode")]).toMatch(/^[1-8]\d{5}$/);
      expect(areaOf(row[columns.indexOf("office_names")] ?? "", "city")).not.toBe("");
    }
  });
});
