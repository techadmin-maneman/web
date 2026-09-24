import { useRef, useState } from "react";

/**
 * Runs one thing at a time, and says while it is running, so a handler that awaits the API cannot
 * be started twice by two taps on one intent.
 *
 * The ref is what holds. `busy` is state and only reaches a button's `disabled` on the next
 * render, so a tap inside that gap would otherwise get through — which is why disabling alone is
 * not enough (docs/decisions/0058-one-tap-per-intent.md).
 */
export function useOneAtATime(): readonly [boolean, (work: () => Promise<void>) => Promise<void>] {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  async function once(work: () => Promise<void>): Promise<void> {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await work();
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return [busy, once] as const;
}
