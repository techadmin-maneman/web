import { useEffect, useState } from "react";

const secondsBetween = (now: number, deadline: number): number => Math.max(0, Math.ceil((deadline - now) / 1000));

/**
 * Whole seconds left until `deadline`, in milliseconds by `now`'s clock, never below nought: the client app counts by
 * the API's clock, the technician app by the phone's. Counting to a deadline, not ticks from when the page learnt of
 * it, keeps a phone that slept in a pocket, where timers slow down, from waking behind.
 */
export function useSecondsLeft(deadline: number, now: () => number = Date.now): number {
  const [left, setLeft] = useState(() => secondsBetween(now(), deadline));
  useEffect(() => {
    setLeft(secondsBetween(now(), deadline));
    const timer = window.setInterval(() => {
      const remaining = secondsBetween(now(), deadline);
      setLeft(remaining);
      if (remaining === 0) window.clearInterval(timer);
    }, 250);
    return () => {
      window.clearInterval(timer);
    };
  }, [deadline, now]);
  return left;
}
