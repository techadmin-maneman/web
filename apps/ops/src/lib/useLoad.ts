import { useCallback, useEffect, useState } from "react";
import type { Answer } from "../api.ts";

export type Loaded<T> =
  { readonly state: "loading" } | { readonly state: "failed" } | { readonly state: "loaded"; readonly value: T };

/** A page's data, fetched when the page opens and again on "Try again". `load` must keep its identity. */
export function useLoad<T>(load: () => Promise<Answer<T>>): readonly [Loaded<T>, () => void] {
  const [loaded, setLoaded] = useState<Loaded<T>>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    void load().then((answer) => {
      if (current) setLoaded(answer.ok ? { state: "loaded", value: answer.body } : { state: "failed" });
    });
    return () => {
      current = false;
    };
  }, [load, attempt]);

  const retry = useCallback(() => {
    setLoaded({ state: "loading" });
    setAttempt((count) => count + 1);
  }, []);
  return [loaded, retry] as const;
}
