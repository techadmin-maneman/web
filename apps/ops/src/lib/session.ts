// Whether Cloudflare Access still lets the console through. The console holds
// no session of its own; Access's lapses after the time the team sets, and from
// then on Access answers every call by sending it to the team's login page, on
// another origin (docs/decisions/0031-access-and-audit.md). A call can see that
// only as a redirect it was not allowed to follow, so api.ts marks it here and
// the frame says so once, over whichever screen is open.

import { useSyncExternalStore } from "react";

let lapsed = false;
const listeners = new Set<() => void>();

export function markLapsed(): void {
  if (lapsed) return;
  lapsed = true;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const useLapsed = (): boolean => useSyncExternalStore(subscribe, () => lapsed);
