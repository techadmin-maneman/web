// The language the app speaks (docs/prompts/tech-redesign.md, "Hindi and language switching"): English or Hindi,
// changed at once, mid-visit too. Every screen draws again in the new language and keeps its place: nothing is
// remounted (./words.ts). Kept on the phone by ./kept.ts.

import { useSyncExternalStore } from "react";

export type Language = "en" | "hi";

let current: Language = "en";
const listeners = new Set<() => void>();

export const languageNow = (): Language => current;

/** Speaks the language from now on, every screen drawn again in it. */
export function speak(language: Language): void {
  current = language;
  if (typeof document !== "undefined") document.documentElement.lang = language;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The language now; a component that calls it draws again when it changes. */
export const useLanguage = (): Language => useSyncExternalStore(subscribe, languageNow);
