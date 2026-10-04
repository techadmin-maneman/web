// The board's data, for the week and city asked for. A new week or city loads afresh. While the board is open it asks
// every minute, and when the tab comes back into view, whether anything on it has changed, and reads itself again
// only when something has; so what another ops user moved shows up without anybody pressing anything. A quiet read
// never shows the loading state and never drops the board it has: the grid keeps its scroll, and the keyboard keeps
// its place.

import type { Loaded } from "@maneman/ui/useLoad";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Board, type BoardQuery } from "../api.ts";

/** How often the open board asks whether anything on it has changed, while nothing is in hand. */
export const POLL_MS = 60_000;
/** How often the open board reads itself in full, for what the version does not watch: a client's name, a badge. */
export const FULL_READ_MS = 10 * 60_000;
/** A look this soon after the last one is skipped, so switching tabs back and forth reads nothing more. */
export const LOOK_GAP_MS = 30_000;

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
  /** The version of the board on screen. */
  const shownVersion = useRef<number | null>(null);
  /** When the board was last read, and when it last looked at all: read itself or asked its version. */
  const lastReadAt = useRef(0);
  const lastLookAt = useRef(0);
  const { from, city } = query;

  const read = useCallback(async (): Promise<Board | null> => {
    reads.current += 1;
    const mine = reads.current;
    lastReadAt.current = Date.now();
    lastLookAt.current = lastReadAt.current;
    const answer = await api.board({ from, city });
    if (mine !== reads.current) return null;
    if (!answer.ok) {
      const failed = { state: "failed", notFound: answer.status === 404, requestId: answer.requestId } as const;
      setLoaded((held) => (held.state === "loaded" ? held : failed));
      return null;
    }
    shownVersion.current = answer.body.version;
    setLoaded({ state: "loaded", value: answer.body });
    setLast(answer.body);
    return answer.body;
  }, [from, city]);

  /** Reads the board again if it has changed, or if it has gone ten minutes without a read. */
  const look = useCallback(async (): Promise<void> => {
    if (document.visibilityState !== "visible") return;
    const now = Date.now();
    if (now - lastLookAt.current < LOOK_GAP_MS) return;
    if (now - lastReadAt.current >= FULL_READ_MS) {
      await read();
      return;
    }
    lastLookAt.current = now;
    const readsBefore = reads.current;
    const answer = await api.boardVersion();
    // A read started meanwhile, for this week or another, has the newer board.
    if (readsBefore !== reads.current) return;
    if (answer.ok && answer.body.version !== shownVersion.current) await read();
  }, [read]);

  useEffect(() => {
    setLoaded({ state: "loading" });
    void read();
  }, [read, attempt]);

  useEffect(() => {
    if (paused) return undefined;
    const quietly = () => {
      void look();
    };
    const timer = window.setInterval(quietly, POLL_MS);
    document.addEventListener("visibilitychange", quietly);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", quietly);
    };
  }, [paused, look]);

  const retry = useCallback(() => {
    setAttempt((count) => count + 1);
  }, []);
  return { loaded, last, refresh: read, retry };
}
