// The device the app is used on (docs/decisions/0029-sessions.md). The phone
// makes one ID for itself, keeps it in its own store, and sends it when the
// technician signs in; the session is then bound to it.
//
// The ID lives with everything else the phone holds, so a wipe takes it too:
// when ops revoke this device, the next sign-in enrols a new one rather than
// reviving the revoked one. The device's label is the server's, from the
// User-Agent at sign-in; the app never sends one.

import type { Me } from "../api.ts";
import { get, put } from "./db.ts";
import { uuidv7 } from "./uuidv7.ts";

interface Kept {
  readonly key: "device";
  readonly id: string;
  readonly enrolled_at: number | null;
}

interface KeptMe {
  readonly key: "me";
  readonly me: Me;
}

/** This phone's device ID, made the first time it is asked for. */
export async function deviceId(): Promise<string> {
  const kept = await get<Kept>("device", "device");
  if (kept !== null) return kept.id;
  const made: Kept = { key: "device", id: uuidv7(), enrolled_at: null };
  await put("device", made);
  return made.id;
}

/** Records that the backend accepted this device, so the screens can say since when. */
export async function enrolled(at: number = Date.now()): Promise<void> {
  const kept = await get<Kept>("device", "device");
  if (kept !== null) await put("device", { ...kept, enrolled_at: at });
}

export async function enrolledAt(): Promise<number | null> {
  return (await get<Kept>("device", "device"))?.enrolled_at ?? null;
}

/**
 * Who is signed in, so the app opens in a basement without asking the API
 * first. It holds a technician's own name and initials and nothing of a
 * client's, and it goes with everything else at sign-out or revocation.
 */
export async function keepMe(me: Me): Promise<void> {
  await put("device", { key: "me", me } satisfies KeptMe);
}

export async function keptMe(): Promise<Me | null> {
  return (await get<KeptMe>("device", "me"))?.me ?? null;
}
