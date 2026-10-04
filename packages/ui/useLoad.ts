import { useCallback, useEffect, useState, type ReactNode } from "react";

/** A call's answer, as packages/web-kit/api.ts gives it, cut to what a page needs. */
type Answered<T> =
  | { readonly ok: true; readonly body: T }
  | { readonly ok: false; readonly status: number; readonly requestId: string | null };

/**
 * `notFound`: the API has no such thing for this person, which trying again will not change. `requestId`: the API's
 * ID for the call, for the person to quote; null when the API never answered.
 */
export type Loaded<T> =
  | { readonly state: "loading" }
  | { readonly state: "failed"; readonly notFound: boolean; readonly requestId: string | null }
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
      if (current) setLoaded(loadedFrom(answer));
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

function loadedFrom<T>(answer: Answered<T>): Loaded<T> {
  if (answer.ok) return { state: "loaded", value: answer.body };
  return { state: "failed", notFound: answer.status === 404, requestId: answer.requestId };
}

/** The failed call's request ID, for a page that draws its failure without asking which state it is in. */
export function failedRequestId(loaded: Loaded<unknown>): string | null {
  return loaded.state === "failed" ? loaded.requestId : null;
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
