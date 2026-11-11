// The language kept on the phone (./language.ts): read before the app first draws, so it opens in it, and kept when
// the technician chooses one, on the sign-in screen or under Me.

import { deviceRecord, put } from "../store/db.ts";
import { speak, type Language } from "./language.ts";

export async function keptLanguage(): Promise<void> {
  const kept = await deviceRecord("language").catch(() => null);
  if (kept !== null) speak(kept.language);
}

/** Speaks the language chosen, and keeps it; where the phone cannot keep it, for this session. */
export function chooseLanguage(language: Language): void {
  speak(language);
  void put("device", { key: "language", language }).catch(() => undefined);
}
