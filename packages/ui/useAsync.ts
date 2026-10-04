import { useCallback, useEffect, useState } from "react";

/** Where an async read stands: still running, failed with what it threw or rejected with, or done with its value. */
export type Settled<T> =
  | { readonly state: "pending" }
  | { readonly state: "failed"; readonly error: unknown }
  | { readonly state: "done"; readonly value: T };

/**
 * An async read a screen draws from: run when the screen opens, again whenever `watch` changes, and on `retry`. A
 * read that rejects settles as failed, so a store or call that throws never leaves a screen waiting. While a read
 * runs again on `watch`, the last one's answer stands; `retry` starts again from pending.
 *
 * `read` must keep its identity from one render to the next (a module's function, or one held in useCallback), or
 * it would run on every render.
 */
export function useAsync<T>(read: () => Promise<T>, watch: unknown = null): readonly [Settled<T>, () => void] {
  const [settled, setSettled] = useState<Settled<T>>({ state: "pending" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    read().then(
      (value) => {
        if (current) setSettled({ state: "done", value });
      },
      (error: unknown) => {
        if (current) setSettled({ state: "failed", error });
      },
    );
    return () => {
      current = false;
    };
  }, [read, watch, attempt]);

  const retry = useCallback(() => {
    setSettled({ state: "pending" });
    setAttempt((count) => count + 1);
  }, []);
  return [settled, retry] as const;
}

/** The value a read settled on, or `otherwise` while it runs and once it has failed. */
export const valueOr = <T>(settled: Settled<T>, otherwise: T): T =>
  settled.state === "done" ? settled.value : otherwise;
