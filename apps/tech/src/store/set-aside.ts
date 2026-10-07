// A technician ops switch off keeps the work their phone has not sent: the steps and photographs waiting stay for
// seven days, for them alone, and go once they are switched back on and sign in. Everything else goes at once, as at
// any sign-out: the day, the clients' cards and who they are. Any other end of a session wipes the phone whole.

import { reportClientError } from "@maneman/web-kit/client-errors";
import { DEVICE_REVOKED, TECHNICIAN_INACTIVE } from "../api.ts";
import { clear, DAY_CACHE, deviceRecord, put, remove, wipe } from "./db.ts";
import { keptMe } from "./device.ts";
import { dropCards, dropJobs } from "./jobs.ts";
import { unsentJobs } from "./outbox.ts";

const KEPT_FOR_MS = 7 * 24 * 60 * 60 * 1000;

const setAside = () => deviceRecord("set_aside");

const stillKept = (aside: { readonly at: number }, now: number) => now - aside.at < KEPT_FOR_MS;

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
  // A delete the browser refused is tried once more, and told to us if it fails again: clients' details may be left.
  if (!(await wipe()) && !(await wipe())) {
    reportClientError({ kind: "error", message: "the phone's store could not be wiped when its session ended" });
  }
  return false;
}

/** Whether there is work to keep: set aside already and within its seven days, or theirs, unsent, as they are switched off. */
async function keepsWork(code: string | null, now: number): Promise<boolean> {
  const aside = await setAside();
  if (aside !== null) return stillKept(aside, now);
  if (code !== TECHNICIAN_INACTIVE) return false;

  const technicianId = (await keptMe())?.id;
  if (technicianId === undefined) return false;
  if ((await unsentJobs()).size === 0) return false;
  await put("device", { key: "set_aside", technician_id: technicianId, at: now });
  return true;
}

async function dropAllButWork(): Promise<void> {
  // No cache storage outside a secure context, and none in the development server.
  if (typeof caches !== "undefined") await caches.delete(DAY_CACHE).catch(() => false);
  await dropCards();
  await remove("device", "me");
}

/** On a sign-in: work set aside goes on if it is theirs and within its seven days, and is dropped otherwise. */
export async function settleSetAside(technicianId: string, now: number = Date.now()): Promise<void> {
  const aside = await setAside();
  if (aside === null) return;
  if (aside.technician_id !== technicianId || !stillKept(aside, now)) {
    await clear("outbox");
    await clear("frames");
    await dropJobs();
  }
  await remove("device", "set_aside");
}
