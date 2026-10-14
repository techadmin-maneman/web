// Whether Cloudflare Access still lets the console through (docs/decisions/0031-access-and-audit.md). Once Access's
// session lapses it sends every call to its login page on another origin, which a call sees only as a redirect it may
// not follow; api.ts marks that here, and the frame says so once.

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
