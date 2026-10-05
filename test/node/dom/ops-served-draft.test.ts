// The Served tab's rules (apps/ops/src/areas/served-draft.ts): only what moved is sent, a save that serves a pincode
// with people waiting is a launch, and a file shows only what it would change.

import { describe, expect, it } from "vitest";
import type { ServedPincode } from "../../../apps/ops/src/api.ts";
import {
  afterSave,
  changesIn,
  draftOf,
  fileChanges,
  launchesIn,
  servesLater,
  withCity,
} from "../../../apps/ops/src/areas/served-draft.ts";

const TODAY = "2027-09-22";

function pincode(code: string, rest: Partial<ServedPincode> = {}): ServedPincode {
  return {
    pincode: code,
    area: "Bandra West",
    city: "Mumbai",
    served: false,
    launch_on: null,
    waiting: 0,
    to_alert: 0,
    ...rest,
  };
}

const BANDRA = pincode("400050", { waiting: 3, to_alert: 2 });
const KHAR = pincode("400052", { area: "Khar", served: true, launch_on: "2027-01-01" });

describe("the Served tab", () => {
  it("sends only what moved, and a renamed area only once its name is trimmed and different", () => {
    const held = [BANDRA, KHAR];
    const draft = draftOf(held);
    expect(changesIn(held, draft)).toEqual([]);
    expect(changesIn(held, { ...draft, "400052": { ...KHAR, area: " Khar " } })).toEqual([]);
    expect(changesIn(held, { ...draft, "400052": { ...KHAR, area: "Khar Road" } })).toEqual([
      { pincode: "400052", served: true, launch_on: "2027-01-01", area: "Khar Road" },
    ]);
  });

  it("treats serving a pincode with people to tell as a launch, and tells them only once", () => {
    const held = [BANDRA, KHAR];
    const changes = changesIn(held, withCity(draftOf(held), held, true));
    expect(changes.map((change) => change.pincode)).toEqual(["400050"]);
    expect(launchesIn(held, changes)).toEqual([BANDRA]);

    const saved = afterSave(held, changes);
    expect(saved[0]).toMatchObject({ served: true, to_alert: 0, waiting: 3 });
    expect(launchesIn(saved, changesIn(saved, draftOf(saved)))).toEqual([]);
  });

  it("refuses to serve from a day still to come, but leaves a held future date alone", () => {
    const later = { pincode: "400050", served: true, launch_on: "2027-10-01" };
    expect(servesLater([BANDRA], later, TODAY)).toBe(true);
    expect(servesLater([BANDRA], { ...later, launch_on: TODAY }, TODAY)).toBe(false);
    const heldLater = pincode("400050", { served: true, launch_on: "2027-10-01" });
    expect(servesLater([heldLater], later, TODAY)).toBe(false);
  });

  it("shows a file's changes only for pincodes we hold that it would change", () => {
    const held = [BANDRA, KHAR];
    const rows = fileChanges(held, draftOf(held), [
      { pincode: "400050", served: true, launch_on: null },
      { pincode: "400052", served: true, launch_on: "2027-01-01" },
      { pincode: "110001", served: true, launch_on: null },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ pincode: BANDRA, now: { served: false }, file: { served: true } });
  });
});
