// The language kept on the phone (./language.ts): read before the app first draws, so it opens in it, and kept when
// the technician chooses one, on the sign-in screen or under Me. It is the phone's, not the technician's, so it is kept
// in this browser's own storage, apart from the database a sign-out wipes whole; storage a browser refuses keeps the
// choice for this page alone, and the app opens in English.

import { speak, type Language } from "./language.ts";

const KEPT = "mm-tech-language";

export function keptLanguage(): void {
  try {
    if (localStorage.getItem(KEPT) === "hi") speak("hi");
  } catch {
    // No storage to read: English.
  }
}

/** Speaks the language chosen, and keeps it. */
export function chooseLanguage(language: Language): void {
  speak(language);
  try {
    localStorage.setItem(KEPT, language);
  } catch {
    // Kept for this page alone.
  }
}
