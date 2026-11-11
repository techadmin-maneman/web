// Where the phone is, for the safety of the technician on a visit (docs/decisions/0248-safety.md): one reading, or none
// where the phone gives none within its time. Never a reason to hold anything back.

import { apiNow } from "@maneman/web-kit/clock";
import type { Position } from "../api.ts";

/** How long a reading may take before the phone is taken to have none. */
const READING_MS = 10_000;

/** One reading of where the phone is; null where it gives none in time, or none at all. */
export function readPosition(): Promise<Position | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (fix) => {
        resolve({
          lat: fix.coords.latitude,
          lng: fix.coords.longitude,
          accuracy_m: fix.coords.accuracy,
          at: new Date(apiNow()).toISOString(),
        });
      },
      () => {
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: READING_MS, maximumAge: 60_000 },
    );
  });
}
