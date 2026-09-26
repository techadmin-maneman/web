import { useCallback, useEffect, useState, type ReactNode } from "react";

/** A call's answer, as packages/web-kit/api.ts gives it, cut to what a page needs. */
type Answered<T> = { readonly ok: true; readonly body: T } | { readonly ok: false; readonly status: number };

/** `notFound`: the API has no such thing for this person, which trying again will not change. */
export type Loaded<T> =
  | { readonly state: "loading" }
  | { readonly state: "failed"; readonly notFound: boolean }
  | { readonly state: "loaded"; readonly value: T };

/**
 * A page's data, fetched when the page opens and again on "Try again". `load`
 * must keep its identity from one render to the next (a module's function, or
 * one held in useCallback), or it would be fetched on every render.
 */
export function useLoad<T>(load: () => Promise<Answered<T>>): readonly [Loaded<T>, () => void] {
  const [loaded, setLoaded] = useState<Loaded<T>>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    void load().then((answer) => {
      if (!current) return;
      setLoaded(
        answer.ok ? { state: "loaded", value: answer.body } : { state: "failed", notFound: answer.status === 404 },
      );
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

/**
 * What a page draws of its data: `loading` while it comes, `failed` if it did
 * not, and `loaded` with it once it has.
 */
export function whenLoaded<T>(
  loaded: Loaded<T>,
  shown: { readonly loading: ReactNode; readonly failed: ReactNode; readonly loaded: (value: T) => ReactNode },
): ReactNode {
  if (loaded.state === "loading") return shown.loading;
  if (loaded.state === "failed") return shown.failed;
  return shown.loaded(loaded.value);
}
