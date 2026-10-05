// The check-in geofence (src/policy/check-in.ts).
// The coordinates are of made-up points near Cyber City, Gurgaon: no real address.

import { describe, expect, it } from "vitest";
import { CHECKIN_RADIUS_M, checkIn, distanceMetres } from "../../../src/policy/check-in.ts";

/** The address a technician is sent to. */
const ADDRESS = { lat: 28.4949, lng: 77.0886 };

/** A point `metres` due north of the address, on the same sphere the policy measures over. */
const METRES_PER_DEGREE = (Math.PI * 6_371_000) / 180;
const north = (metres: number) => ({ lat: ADDRESS.lat + metres / METRES_PER_DEGREE, lng: ADDRESS.lng });

describe("check-in", () => {
  it("passes a check-in within 200 m of the address, and not beyond", () => {
    expect(CHECKIN_RADIUS_M).toBe(200);
    expect(checkIn(north(150), ADDRESS).passed).toBe(true);
    expect(checkIn(north(250), ADDRESS).passed).toBe(false);
  });

  it("passes at the radius itself, and not a metre beyond", () => {
    expect(checkIn(north(CHECKIN_RADIUS_M), ADDRESS)).toEqual({ distanceM: 200, radiusM: 200, passed: true });
    expect(checkIn(north(CHECKIN_RADIUS_M + 1), ADDRESS)).toEqual({ distanceM: 201, radiusM: 200, passed: false });
  });

  it("keeps the distance measured and the radius in force, whether the check-in passed or not", () => {
    // The distance is logged whether the check-in passed or not, and so is the
    // radius in force, so a tuned radius can be told from the old one.
    expect(checkIn(north(900), ADDRESS)).toEqual({ distanceM: 900, radiusM: 200, passed: false });
    expect(checkIn(north(300), ADDRESS, 500)).toEqual({ distanceM: 300, radiusM: 500, passed: true });
  });

  it("measures whole metres in every direction", () => {
    expect(distanceMetres(ADDRESS, ADDRESS)).toBe(0);
    expect(distanceMetres(ADDRESS, north(-200))).toBe(200);
    // East, where a degree of longitude is shorter this far north.
    expect(distanceMetres(ADDRESS, { lat: ADDRESS.lat, lng: ADDRESS.lng + 0.002 })).toBe(195);
  });
});
