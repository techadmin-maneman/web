// The task board, read once for the Tasks screen and the navigation's counts both. The navigation reads it again as a
// page opens or the window comes back into view, at most once a minute.

import { useEffect, useSyncExternalStore } from "react";
import { api, type Answer, type Tasks } from "../api.ts";

export const FRESH_MS = 60_000;

let board: Tasks | null = null;
let readAt = 0;
let reading: Promise<Answer<Tasks>> | null = null;
const listeners = new Set<() => void>();

/** Reads the board afresh, or joins the read already under way. */
export function readTasks(): Promise<Answer<Tasks>> {
  reading ??= api.tasks().then((answer) => {
    reading = null;
    if (answer.ok) {
      board = answer.body;
      readAt = Date.now();
      for (const listener of listeners) listener();
    }
    return answer;
  });
  return reading;
}

function readIfStale(): void {
  if (Date.now() - readAt < FRESH_MS) return;
  void readTasks();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The board as last read, for a person whose calls to it go ahead; null until it has been read. */
export function useTaskBoard(mayRead: boolean): Tasks | null {
  useEffect(() => {
    if (!mayRead) return;
    readIfStale();
    window.addEventListener("focus", readIfStale);
    return () => {
      window.removeEventListener("focus", readIfStale);
    };
  }, [mayRead]);
  const read = useSyncExternalStore(subscribe, () => board);
  return mayRead ? read : null;
}
