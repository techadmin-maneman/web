// The task board, read once for the Tasks screen and the navigation's counts both, in the header's city (./city.ts).
// The navigation reads it again as a page opens or the window comes back into view, at most once a minute, and at
// once when another city is chosen.

import { useEffect, useSyncExternalStore } from "react";
import { api, type Answer, type Tasks } from "../api.ts";
import { apiNow } from "@maneman/web-kit/clock";
import { useCity } from "./city.ts";

const FRESH_MS = 60_000;

/** The board as last read, and the city it was read for; null for every city. */
let board: { readonly tasks: Tasks; readonly city: string | null } | null = null;
let readAt = 0;
let reading: { readonly city: string | null; readonly answer: Promise<Answer<Tasks>> } | null = null;
const listeners = new Set<() => void>();

/** Reads the board afresh for the city, or joins the read for it already under way. */
export function readTasks(city: string | null): Promise<Answer<Tasks>> {
  if (reading?.city === city) return reading.answer;
  const answer = api.tasks(city).then((answered) => {
    if (reading?.answer === answer) reading = null;
    if (answered.ok) {
      board = { tasks: answered.body, city };
      readAt = apiNow();
      for (const listener of listeners) listener();
    }
    return answered;
  });
  reading = { city, answer };
  return answer;
}

function readIfStale(city: string | null): void {
  if (board?.city === city && apiNow() - readAt < FRESH_MS) return;
  void readTasks(city);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The board as last read for the header's city, for a person whose calls to it go ahead; null until it has been. */
export function useTaskBoard(mayRead: boolean): Tasks | null {
  const { city } = useCity();
  useEffect(() => {
    if (!mayRead) return;
    const again = () => {
      readIfStale(city);
    };
    again();
    window.addEventListener("focus", again);
    return () => {
      window.removeEventListener("focus", again);
    };
  }, [mayRead, city]);
  const read = useSyncExternalStore(subscribe, () => board);
  return mayRead && read?.city === city ? read.tasks : null;
}
