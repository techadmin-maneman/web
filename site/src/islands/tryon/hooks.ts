// The try-on's timers and polls: the processing countdown, the watch on the
// render until the gate, the wait for the result after it, and the object URLs
// the page shows photographs from.

import { useEffect, useState } from "preact/hooks";
import { tryOn } from "../../content/site.ts";
import { fetchResult, jobStatus } from "../../lib/api.ts";
import { failureKindOf, jobProblem, type Failure } from "../../lib/tryon-errors.ts";
import type { Rendered, Showing } from "./machine.ts";

/** How often the page asks how the render is going. */
const POLL_MS = 3_000;
/** Renders take 30 to 180 seconds; after this long on the result screen, the page gives up. */
const RESULT_WAIT_MS = 5 * 60_000;

/** The seconds since the component appeared, up to `seconds`. */
export function useCountdown(seconds: number): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed((done) => Math.min(done + 1, seconds));
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [seconds]);
  return elapsed;
}

/**
 * While `watching`, asks after the render named by `jobId` and reports how it failed, if it does. Only `watching`
 * starts and stops it: the island draws a new `onProblem` each time, and the one it started with does the same.
 */
export function useRenderWatch(
  watching: boolean,
  jobId: { readonly current: string | null },
  onProblem: (failure: Failure) => void,
): void {
  useEffect(() => {
    if (!watching) return;
    const timer = setInterval(() => {
      const id = jobId.current;
      if (id === null) return;
      void jobStatus(id).then((answer) => {
        const problem = answer.ok ? jobProblem(answer.body) : null;
        if (problem !== null && jobId.current === id) onProblem(problem);
      });
    }, POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [watching]);
}

/** Fetches the result image once, for the page and for sharing. */
async function loadRendered(url: string): Promise<Rendered | null> {
  const response = await fetch(url).catch(() => null);
  if (response?.ok !== true) return null;
  const blob = await response.blob();
  const extension = blob.type === "image/png" ? "png" : "jpg";
  return {
    url: URL.createObjectURL(blob),
    file: new File([blob], `${tryOn.result.fileName}.${extension}`, { type: blob.type }),
  };
}

/** Asks for `showing`'s result until it is ready, then fetches it once. Null asks for nothing. */
export function useResult(
  showing: Showing | null,
  onReady: (rendered: Rendered, showing: Showing) => void,
  onFail: (failure: Failure) => void,
): void {
  useEffect(() => {
    if (showing === null) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    const check = async () => {
      const answer = await fetchResult(showing.jobId);
      if (stopped) return;
      if (answer.kind === "ready") {
        void loadRendered(answer.url).then((image) => {
          if (stopped) return;
          if (image === null) onFail({ kind: "busy", code: "result_unavailable" });
          else onReady(image, showing);
        });
        return;
      }
      if (answer.kind === "failed") {
        onFail({ kind: failureKindOf(answer.failureCode), code: answer.failureCode });
        return;
      }
      if (answer.kind === "error" && answer.code !== "network") {
        onFail({ kind: "busy", code: answer.code });
        return;
      }
      if (Date.now() - started > RESULT_WAIT_MS) {
        onFail({ kind: "busy", code: "result_timeout" });
        return;
      }
      timer = setTimeout(() => void check(), POLL_MS);
    };
    void check();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [showing]);
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
