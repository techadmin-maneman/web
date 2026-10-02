// A technician ops switch off keeps the work his phone has not sent: the steps and photographs waiting stay for
// seven days, for him alone, and go once he is switched back on and signs in. Everything else goes at once, as at
// any sign-out: the day, the clients' cards and who he is. Any other end of a session wipes the phone whole.

import { DEVICE_REVOKED, TECHNICIAN_INACTIVE } from "../api.ts";
import { clear, DAY_CACHE, get, put, remove, wipe } from "./db.ts";
import { keptMe } from "./device.ts";
import { dropCards } from "./jobs.ts";
import { unsentJobs } from "./outbox.ts";

const KEPT_FOR_MS = 7 * 24 * 60 * 60 * 1000;

interface SetAside {
  readonly key: "set_aside";
  readonly technician_id: string;
  /** When he was switched off, in milliseconds; the seven days run from here. */
  readonly at: number;
}

const setAside = () => get<SetAside>("device", "set_aside");

const stillKept = (aside: SetAside, now: number) => now - aside.at < KEPT_FOR_MS;

/**
 * What the phone keeps once its session has ended: the work set aside for a switched-off technician, for seven
 * days, or nothing at all. Answers whether work is set aside.
 */
export async function leaveSignedOut(code: string | null, now: number = Date.now()): Promise<boolean> {
  try {
    if (code !== DEVICE_REVOKED && (await keepsWork(code, now))) {
      await dropAllButWork();
      return true;
    }
  } catch {
    // A store that will not answer keeps nothing: the phone is wiped whole below.
  }
  await wipe();
  return false;
}

/** Whether there is work to keep: set aside already and within its seven days, or his, unsent, as he is switched off. */
async function keepsWork(code: string | null, now: number): Promise<boolean> {
  const aside = await setAside();
  if (aside !== null) return stillKept(aside, now);
  if (code !== TECHNICIAN_INACTIVE) return false;

  const technicianId = (await keptMe())?.id;
  if (technicianId === undefined) return false;
  if ((await unsentJobs()).size === 0) return false;
  await put("device", { key: "set_aside", technician_id: technicianId, at: now } satisfies SetAside);
  return true;
}

async function dropAllButWork(): Promise<void> {
  // No cache storage outside a secure context, and none in the development server.
  if (typeof caches !== "undefined") await caches.delete(DAY_CACHE).catch(() => false);
  await dropCards();
  await remove("device", "me");
}

/** On a sign-in: work set aside goes on if it is his and within its seven days, and is dropped otherwise. */
export async function settleSetAside(technicianId: string, now: number = Date.now()): Promise<void> {
  const aside = await setAside();
  if (aside === null) return;
  if (aside.technician_id !== technicianId || !stillKept(aside, now)) {
    await clear("outbox");
    await clear("frames");
    await clear("jobs");
  }
  await remove("device", "set_aside");
}
