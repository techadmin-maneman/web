// The try-on's timers: the watch on the render once its look is on its way to
// WhatsApp, and the object URLs the page shows the photograph from.

import { useEffect } from "preact/hooks";
import { jobStatus } from "../../lib/api.ts";
import { jobProblem, type Failure } from "../../lib/tryon-errors.ts";

/** How often the page asks how the render is going. */
const POLL_MS = 3_000;
/** Renders take 30 to 180 seconds; after this long the page stops asking, and the message still goes when it can. */
const WATCH_MS = 5 * 60_000;

/**
 * While `watching`, asks after the render named by `jobId` until it is ready, and reports how it failed, if it does.
 * Only `watching` starts and stops it: the island draws a new `onProblem` each time, and the one it started with
 * does the same.
 */
export function useRenderWatch(
  watching: boolean,
  jobId: { readonly current: string | null },
  onProblem: (failure: Failure) => void,
): void {
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
        const problem = jobProblem(answer.body);
        if (problem !== null) onProblem(problem);
      });
    }, POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [watching]);
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
