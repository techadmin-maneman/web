// The technician app's session, from its cookie, mm_tech (src/http/session-cookie.ts), bound to the phone it was
// opened on (docs/decisions/0052-technician-sessions.md).
//
// "His sessions are bound to a device and can be revoked by ops. Revoking also
// wipes the device's cached jobs on its next contact": a call from a revoked
// phone is answered `device_revoked`, and the app drops what it cached.

import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "./context.ts";
import { findSession, revokeSession, SESSION_TOUCH_MS, touchSession } from "../domain/sign-in/sessions.ts";
import { deviceOfSession, markWiped, touchDevice } from "../domain/dispatch/technicians.ts";
import { sha256Hex } from "../lib/hash.ts";
import { refuse } from "./errors.ts";
import { sessionCookie } from "./session-cookie.ts";

const TECHNICIAN = sessionCookie("__Host-mm_tech", "mm_tech");

/** The technician this request is from, and the phone he is on. */
export interface TechnicianSession {
  readonly sessionId: string;
  readonly technicianId: string;
  /** The technician_devices row, not the phone's own ID. */
  readonly deviceRowId: string;
  readonly deviceId: string;
}

export const setTechnicianCookie = TECHNICIAN.set;
export const clearTechnicianCookie = TECHNICIAN.clear;

/**
 * Refuses a request without a live session on an enrolled phone, and moves the
 * session's expiry on (at most hourly). Sets c.var.technicianSession.
 */
export const requireTechnicianSession = createMiddleware<AppEnv>(async (c, next) => {
  const token = TECHNICIAN.tokenOf(c);
  const now = c.var.deps.now();
  if (token === null) return refuse(c, "session_required");

  // The device is read first: revoking one, or switching its technician off, ends its session too, and the phone
  // must hear which, not just that it is logged out.
  const sessionId = await sha256Hex(token);
  const device = await deviceOfSession(c.env.DB, sessionId);
  if (device !== null && device.revokedAt !== null) {
    await markWiped(c.env.DB, device.id, now);
    clearTechnicianCookie(c);
    return refuse(c, "device_revoked");
  }

  // A technician switched off has left, or is away from the work: the app drops the clients' cards it holds and
  // sets aside the work it has not sent, which goes once he is switched back on and signs in again.
  if (device !== null && !device.technicianActive) {
    await revokeSession(c.env.DB, sessionId, now);
    clearTechnicianCookie(c);
    return refuse(c, "technician_inactive");
  }

  const session = await findSession(c.env.DB, "technician", token, now);
  if (session === null || device === null) return refuse(c, "session_required");

  if (now.getTime() - session.lastSeenAt.getTime() > SESSION_TOUCH_MS) {
    await touchSession(c.env.DB, session, now);
    await touchDevice(c.env.DB, device.id, now);
    setTechnicianCookie(c, token);
  }
  c.set("technicianSession", {
    sessionId: session.id,
    technicianId: session.subjectId,
    deviceRowId: device.id,
    deviceId: device.deviceId,
  });
  return next();
});

/** The session the middleware set, or a thrown error: a route behind it always has one. */
export function technicianOf(c: Context<AppEnv>): TechnicianSession {
  const session = c.var.technicianSession;
  if (session === undefined) throw new Error("technician routes run after requireTechnicianSession");
  return session;
}
