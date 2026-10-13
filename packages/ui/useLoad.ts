import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAsync, type Settled } from "./useAsync.ts";

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
 * one held in useCallback), or it would be fetched on every render. A load that
 * throws fails as one the API never answered.
 */
export function useLoad<T>(load: () => Promise<Answered<T>>): readonly [Loaded<T>, () => void] {
  const [settled, retry] = useAsync(load);
  const loaded = useMemo(() => loadedOf(settled), [settled]);
  return [loaded, retry] as const;
}

interface LiveLoad<T> {
  readonly loaded: Loaded<T>;
  /** Reads again, keeping what is shown until the answer comes; a failure keeps it too. */
  readonly refresh: () => void;
  /** Reads again from loading, as "Try again" does. */
  readonly retry: () => void;
}

const NOT_ANSWERED = { state: "failed", notFound: false, requestId: null } as const;

/**
 * A page's data that keeps itself current: fetched when the page opens, again every `everyMs` while the page is in
 * view and as soon as it comes back into view, and on `refresh`. Only the first read, and "Try again", show loading
 * or a failure; a read again keeps what is shown, so a list being worked through never blanks. `load` keeps its
 * identity from one render to the next, as useLoad's does.
 */
export function useLiveLoad<T>(load: () => Promise<Answered<T>>, everyMs: number): LiveLoad<T> {
  const [loaded, setLoaded] = useState<Loaded<T>>({ state: "loading" });
  const reads = useRef(0);
  const read = useCallback(
    async (quietly: boolean) => {
      const mine = ++reads.current;
      if (!quietly) setLoaded({ state: "loading" });
      const next = await load().then(loadedFrom, (): Loaded<T> => NOT_ANSWERED);
      // A later read has the newer answer.
      if (mine !== reads.current) return;
      setLoaded((shown) => (quietly && next.state === "failed" && shown.state === "loaded" ? shown : next));
    },
    [load],
  );
  useEffect(() => {
    void read(false);
  }, [read]);
  useEffect(() => {
    const quietly = () => {
      if (document.visibilityState === "visible") void read(true);
    };
    const timer = window.setInterval(quietly, everyMs);
    document.addEventListener("visibilitychange", quietly);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", quietly);
    };
  }, [read, everyMs]);
  const refresh = useCallback(() => void read(true), [read]);
  const retry = useCallback(() => void read(false), [read]);
  return { loaded, refresh, retry };
}

function loadedOf<T>(settled: Settled<Answered<T>>): Loaded<T> {
  if (settled.state === "pending") return { state: "loading" };
  if (settled.state === "failed") return { state: "failed", notFound: false, requestId: null };
  return loadedFrom(settled.value);
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
