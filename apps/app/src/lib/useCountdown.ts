import { useEffect, useState } from "react";

/** Whole seconds left of `seconds`, counted from when `from` last changed. */
export function useCountdown(seconds: number, from: unknown): number {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    setLeft(seconds);
    if (seconds <= 0) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, seconds - Math.floor((Date.now() - started) / 1000));
      setLeft(remaining);
      if (remaining === 0) window.clearInterval(timer);
    }, 250);
    return () => {
      window.clearInterval(timer);
    };
  }, [seconds, from]);
  return left;
}
