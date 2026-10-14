// The try-on's timers and its place in the browser: the watch on the render once its look is on its way to
// WhatsApp, the object URLs the page shows the photograph from, and a history entry for each screen.

import { useEffect, useRef } from "preact/hooks";
import { useLatest } from "../useLatest.ts";
import { jobStatus } from "../../lib/api.ts";
import { jobProblem, type Failure } from "../../lib/tryon-errors.ts";
import { backFrom, type Screen, type TryOnEvent } from "./machine.ts";

/** How often the page asks how the render is going. */
const POLL_MS = 3_000;
/** Renders take 30 to 180 seconds; after this long the page stops asking, and the message still goes when it can. */
const WATCH_MS = 5 * 60_000;

/**
 * While `watching`, asks after the render named by `jobId` until it is ready, and reports how it failed, if it does.
 * Only `watching` starts and stops it: the island draws a new `onProblem` each time, and the newest is the one called.
 */
export function useRenderWatch(
  watching: boolean,
  jobId: { readonly current: string | null },
  onProblem: (failure: Failure) => void,
): void {
  const problem = useLatest(onProblem);
  useEffect(() => {
    if (!watching) return;
    const started = Date.now();
    const timer = setInterval(() => {
      const id = jobId.current;
      if (id === null) return;
      if (Date.now() - started > WATCH_MS) {
        clearInterval(timer);
        return;
      }
      void jobStatus(id).then((answer) => {
        if (!answer.ok || jobId.current !== id) return;
        if (answer.body.state === "ready") clearInterval(timer);
        const found = jobProblem(answer.body);
        if (found !== null) problem.current(found);
      });
    }, POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [watching, jobId, problem]);
}

/** Releases an object URL once it is replaced or the page is done with it. */
export function useReleased(url: string | null): void {
  useEffect(
    () => () => {
      if (url !== null) URL.revokeObjectURL(url);
    },
    [url],
  );
}

/**
 * Each screen after the first is an entry in the browser's history, holding its place alone and never the photo, so
 * the browser's Back, or a phone's back gesture, steps back through the try-on as its own Back does, and leaves for
 * the site where that would. `on` is false for a preview's stand-ins. Answers whether the try-on has written an entry
 * its own Back should go back through.
 */
export function useScreenHistory(screen: Screen, send: (event: TryOnEvent) => void, on: boolean): () => boolean {
  /** Entries written so far, and the screen showing, as the listener reads them. */
  const depth = useRef(0);
  const showing = useRef(screen);
  /** A screen Back opened, which writes no entry of its own. */
  const returning = useRef(false);
  const first = useRef(true);
  const sent = useLatest(send);
  showing.current = screen;

  useEffect(() => {
    if (!on) return;
    const listener = (event: PopStateEvent) => {
      const state = event.state as { tryOn?: unknown } | null;
      const at = typeof state?.tryOn === "number" ? state.tryOn : 0;
      // Forward leaves the screen as it is.
      if (at >= depth.current) return;
      depth.current = at;
      if (backFrom(showing.current) === "home") {
        location.assign("/");
        return;
      }
      returning.current = true;
      sent.current({ type: "back" });
    };
    addEventListener("popstate", listener);
    return () => {
      removeEventListener("popstate", listener);
    };
  }, [on, sent]);

  useEffect(() => {
    if (first.current || !on) {
      first.current = false;
      return;
    }
    if (returning.current) {
      returning.current = false;
      return;
    }
    depth.current += 1;
    history.pushState({ tryOn: depth.current }, "");
  }, [screen, on]);

  return () => depth.current > 0;
}
