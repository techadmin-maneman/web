// The board's data, for the week and city asked for. A new week or city loads
// afresh; after that the board is read again quietly, on a minute's timer and
// whenever the tab comes back into view, so what another ops user moved shows
// up without anybody pressing anything (FEO-05). A quiet read never shows the
// loading state and never drops the board it has: the grid keeps its scroll,
// and the keyboard keeps its place (FEO-14).

import type { Loaded } from "@maneman/ui/useLoad";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Board, type BoardQuery } from "../api.ts";

/** How often the board is read again while it is open and nothing is in hand. */
export const REFRESH_MS = 60_000;

export interface BoardData {
  readonly loaded: Loaded<Board>;
  /** The last board that loaded, kept while the next week or city loads, so the controls stay in reach. */
  readonly last: Board | null;
  /** Reads the board again without showing the loading state; the new board, or null if the read failed. */
  readonly refresh: () => Promise<Board | null>;
  /** After a failed first load, loads it again. */
  readonly retry: () => void;
}

/** `paused`: a job is in hand or a panel is open, so the board is not redrawn under ops' hands. */
export function useBoard(query: BoardQuery, paused: boolean): BoardData {
  const [loaded, setLoaded] = useState<Loaded<Board>>({ state: "loading" });
  const [last, setLast] = useState<Board | null>(null);
  const [attempt, setAttempt] = useState(0);
  /** Each read's number, so an answer that comes back after a later one's is dropped. */
  const reads = useRef(0);
  const { from, city } = query;

  const read = useCallback(async (): Promise<Board | null> => {
    reads.current += 1;
    const mine = reads.current;
    const answer = await api.board({ from, city });
    if (mine !== reads.current) return null;
    if (!answer.ok) {
      setLoaded((held) => (held.state === "loaded" ? held : { state: "failed", notFound: answer.status === 404 }));
      return null;
    }
    setLoaded({ state: "loaded", value: answer.body });
    setLast(answer.body);
    return answer.body;
  }, [from, city]);

  useEffect(() => {
    setLoaded({ state: "loading" });
    void read();
  }, [read, attempt]);

  useEffect(() => {
    if (paused) return undefined;
    const quietly = () => {
      if (document.visibilityState === "visible") void read();
    };
    const timer = window.setInterval(quietly, REFRESH_MS);
    window.addEventListener("focus", quietly);
    document.addEventListener("visibilitychange", quietly);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", quietly);
      document.removeEventListener("visibilitychange", quietly);
    };
  }, [paused, read]);

  const retry = useCallback(() => {
    setAttempt((count) => count + 1);
  }, []);
  return { loaded, last, refresh: read, retry };
}
