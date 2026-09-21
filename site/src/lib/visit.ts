// The visit's attribution, captured on its first page and held in
// sessionStorage until a booking or a try-on gate sends it.

import type { Attribution } from "./api.ts";
import { attributionFrom } from "./attribution.ts";

const KEY = "mm_attribution";

/** Runs on every page; keeps the first page's attribution for the visit. */
export function captureAttribution(): void {
  try {
    if (sessionStorage.getItem(KEY) !== null) return;
    sessionStorage.setItem(KEY, JSON.stringify(attributionFrom(new URL(location.href), document.referrer)));
  } catch {
    // Storage can be blocked; the booking goes through without attribution.
  }
}

export function readAttribution(): Attribution | undefined {
  try {
    const stored = sessionStorage.getItem(KEY);
    return stored === null ? undefined : (JSON.parse(stored) as Attribution);
  } catch {
    return undefined;
  }
}
