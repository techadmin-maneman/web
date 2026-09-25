import { useEffect, useState } from "react";
import { secondsUntil } from "./clock.ts";

/**
 * Whole seconds left until `deadline`, a time by the API's clock in
 * milliseconds (./clock.ts), counted down in whole seconds and never below
 * nought. Counting to a deadline, not from when the page learnt of it, keeps a
 * phone that slept for a minute from waking a minute behind.
 */
export function useSecondsLeft(deadline: number): number {
  const [left, setLeft] = useState(() => secondsUntil(deadline));
  useEffect(() => {
    setLeft(secondsUntil(deadline));
    const timer = window.setInterval(() => {
      const now = secondsUntil(deadline);
      setLeft(now);
      if (now === 0) window.clearInterval(timer);
    }, 250);
    return () => {
      window.clearInterval(timer);
    };
  }, [deadline]);
  return left;
}
