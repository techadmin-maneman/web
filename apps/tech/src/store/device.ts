// The device the app is used on (docs/decisions/0029-sessions.md). The phone
// makes one ID for itself, keeps it in its own store, and sends it when the
// technician signs in; the session is then bound to it.
//
// The ID lives with everything else the phone holds, so a wipe takes it too:
// when ops revoke this device, the next sign-in enrols a new one rather than
// reviving the revoked one. The device's label is the server's, from the
// User-Agent at sign-in; the app never sends one.

import { apiOffset, heardFromApi, startFrom } from "@maneman/web-kit/clock";
import type { Me } from "../api.ts";
import { deviceRecord, put } from "./db.ts";
import { uuidv7 } from "./uuidv7.ts";

/** This phone's device ID, made the first time it is asked for. */
export async function deviceId(): Promise<string> {
  const kept = await deviceRecord("device");
  if (kept !== null) return kept.id;
  const id = uuidv7();
  await put("device", { key: "device", id, enrolled_at: null });
  return id;
}

/** Records that the backend accepted this device, so the screens can say since when. */
export async function enrolled(at: number = Date.now()): Promise<void> {
  const kept = await deviceRecord("device");
  if (kept !== null) await put("device", { ...kept, enrolled_at: at });
}

export async function enrolledAt(): Promise<number | null> {
  return (await deviceRecord("device"))?.enrolled_at ?? null;
}

/**
 * Who is signed in, so the app opens in a basement without asking the API
 * first. It holds a technician's own name and initials and nothing of a
 * client's, and it goes with everything else at sign-out or revocation.
 */
export async function keepMe(me: Me): Promise<void> {
  await put("device", { key: "me", me });
}

export async function keptMe(): Promise<Me | null> {
  return (await deviceRecord("me"))?.me ?? null;
}

/** The header counts whole seconds, so an offset moved less than this from the one kept is not written again. */
const KEEP_AFTER_MS = 2_000;

/** What a fresh answer's Date header said; the offset is kept on the phone when it has moved. */
export async function heardClock(date: string | null): Promise<void> {
  heardFromApi(date);
  const offset = apiOffset();
  const kept = (await deviceRecord("clock"))?.offset ?? 0;
  if (Math.abs(offset - kept) < KEEP_AFTER_MS) return;
  await put("device", { key: "clock", offset });
}

/** With no answer to hear, the API's clock as the phone last knew it. */
export async function startFromKeptClock(): Promise<void> {
  const kept = await deviceRecord("clock");
  if (kept !== null) startFrom(kept.offset);
}
