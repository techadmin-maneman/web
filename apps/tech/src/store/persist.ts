// Whether the phone has promised to keep what the outbox holds. An iPhone keeps an origin's storage only in persistent
// mode, which WebKit grants by its own heuristics (webkit.org/blog/14403/updates-to-storage-policy/), so a phone that
// will not promise is said on Today, rather than left to lose a basement's work.

import { deviceRecord, put } from "./db.ts";

/** Not answered yet, granted, refused, or a browser too old to be asked (and so no promise either). */
export type Keeping = "asking" | "granted" | "refused" | "unknown";

/**
 * Asks the phone, and remembers only a yes. A refusal is asked again on the
 * next start, because a browser's heuristics warm to an app it sees often and
 * today's no can be next week's yes; remembering it would leave the warning
 * standing long after it stopped being true. A wipe takes the yes with
 * everything else, which is right: an installed app and the browser it was
 * installed from are two stores, and one's answer says nothing about the other.
 */
export async function askToKeep(): Promise<Keeping> {
  if ((await deviceRecord("keeping")) !== null) return "granted";

  const keeping = await ask();
  if (keeping === "granted") await put("device", { key: "keeping", keeping });
  return keeping;
}

async function ask(): Promise<Keeping> {
  // Typed as always there, but an older WebKit has no StorageManager and an
  // insecure context has none either, so this is a real check.
  const storage = navigator.storage as StorageManager | undefined;
  if (typeof storage?.persist !== "function") return "unknown";
  try {
    return (await storage.persist()) ? "granted" : "refused";
  } catch {
    return "unknown";
  }
}
