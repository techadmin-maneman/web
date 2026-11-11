// Where the phone is, for the safety of the technician on a visit (docs/decisions/0248-safety.md): one reading, or none
// where the phone gives none within its time. Never a reason to hold anything back.

import { apiNow } from "@maneman/web-kit/clock";
import type { Position } from "../api.ts";

/**
 * How a reading is taken: quick, from what the phone knows already or can tell at once, for an SOS that must go now;
 * or close, from the satellites, which takes longer.
 */
const READINGS: Readonly<Record<"quick" | "close", PositionOptions>> = {
  quick: { enableHighAccuracy: false, timeout: 3_000, maximumAge: 10 * 60_000 },
  close: { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
};

/** One reading of where the phone is; null where it gives none in time, or none at all. */
export function readPosition(how: "quick" | "close" = "close"): Promise<Position | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (fix) => {
        // When the phone took the fix, which a quick reading may have kept a while, on the API's clock.
        resolve({
          lat: fix.coords.latitude,
          lng: fix.coords.longitude,
          accuracy_m: fix.coords.accuracy,
          at: new Date(fix.timestamp + (apiNow() - Date.now())).toISOString(),
        });
      },
      () => {
        resolve(null);
      },
      READINGS[how],
    );
  });
}
