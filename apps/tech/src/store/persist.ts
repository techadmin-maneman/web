// Whether the phone has promised to keep what the outbox holds.
//
// Open point 124 is now "any phone, including iPhones", and an iPhone treats
// this store differently from an Android one. WebKit puts every origin in a
// "best-effort mode, which means their persistence is not guaranteed and their
// data can be evicted", and evicts least-recently-used; an origin escapes that
// only if "its storage is in persistent mode". WebKit "currently grants a
// request based on heuristics like whether the website is opened as a Home
// Screen Web App" (webkit.org/blog/14403/updates-to-storage-policy/), which is
// why the app is installable — see apps/tech/index.html.
//
// So the answer is not ours to decide, and it may be no. A job captured in a
// basement and evicted before it uploads is lost work and lost evidence, so
// when the phone will not promise, the technician is told rather than left to
// find out (apps/tech/src/today/TodayScreen.tsx).

import { get, put } from "./db.ts";

/** Not answered yet, granted, refused, or a browser too old to be asked (and so no promise either). */
export type Keeping = "asking" | "granted" | "refused" | "unknown";

interface Kept {
  readonly key: "keeping";
  /** Only ever "granted": see below. */
  readonly keeping: "granted";
}

/**
 * Asks the phone, and remembers only a yes. A refusal is asked again on the
 * next start, because a browser's heuristics warm to an app it sees often and
 * today's no can be next week's yes; remembering it would leave the warning
 * standing long after it stopped being true. A wipe takes the yes with
 * everything else, which is right: an installed app and the browser it was
 * installed from are two stores, and one's answer says nothing about the other.
 */
export async function askToKeep(): Promise<Keeping> {
  if ((await get<Kept>("device", "keeping")) !== null) return "granted";

  const keeping = await ask();
  if (keeping === "granted") await put("device", { key: "keeping", keeping } satisfies Kept);
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
