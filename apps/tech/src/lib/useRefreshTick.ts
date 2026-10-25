// When a screen that shows the day should read it again: the app coming back to the front, the phone finding signal,
// and every few minutes while it stays open, so a job ops add or move shows without the technician doing anything.

import { useEffect, useState } from "react";

const EVERY_MS = 5 * 60_000;

export function useRefreshTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const again = () => {
      if (document.visibilityState === "visible") setTick((was) => was + 1);
    };
    const timer = window.setInterval(again, EVERY_MS);
    document.addEventListener("visibilitychange", again);
    window.addEventListener("online", again);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", again);
      window.removeEventListener("online", again);
    };
  }, []);
  return tick;
}
