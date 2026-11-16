// When the phone's work last reached us, said on Pending uploads once nothing is waiting. A time and nothing of the
// client's, so it is kept in this browser's own storage beside the language (../lang/kept.ts); storage a browser
// refuses leaves the line unsaid.

const KEY = "mm-tech-last-sync";

/** Keeps when a round of sending last landed something. */
export function synced(at: number): void {
  try {
    localStorage.setItem(KEY, String(at));
  } catch {
    // Not kept: the line goes unsaid.
  }
}

/** When the phone's work last reached us; null where it never has, or storage would not say. */
export function lastSynced(): number | null {
  try {
    const at = Number(localStorage.getItem(KEY));
    return Number.isFinite(at) && at > 0 ? at : null;
  } catch {
    return null;
  }
}
