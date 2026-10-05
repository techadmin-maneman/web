// Reading the pincode list (scripts/lib/pincodes.ts): each pincode's area, from its post offices.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { areaOf, fields, launchesWithPeopleWaiting, type PincodeRow } from "../../../scripts/lib/pincodes.ts";

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

// The import tells nobody, so it never serves a pincode people are waiting for: the console's launch does, and tells
// them (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).
describe("the import's launches", () => {
  const row = (pincode: string, served: boolean): PincodeRow => ({
    pincode,
    area: "Saket",
    city: "Delhi",
    served,
    launchedAt: served ? "2026-09-21T18:30:00.000Z" : null,
  });

  it("names each pincode the file would serve that is not served yet and has people waiting", () => {
    const rows = [row("110017", true), row("110030", true), row("110044", true), row("110048", false)];
    const waiting = [
      { pincode: "110017", served: 0, waiting: 3 }, // would launch: refused
      { pincode: "110030", served: 1, waiting: 2 }, // already served, so the import launches nothing
      { pincode: "110048", served: 0, waiting: 1 }, // the file leaves it unserved
      { pincode: "110092", served: 0, waiting: 4 }, // not in the file
    ];

    expect(launchesWithPeopleWaiting(rows, waiting)).toEqual([{ pincode: "110017", waiting: 3 }]);
  });

  it("names none where nobody waits", () => {
    expect(launchesWithPeopleWaiting([row("110017", true)], [])).toEqual([]);
  });
});
