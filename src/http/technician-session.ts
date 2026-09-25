// The technician app's session cookie, mm_tech (docs/decisions/0029-sessions.md):
// host-only, HttpOnly, Secure, SameSite=Lax, 90 days from last use, and bound
// to the phone it was opened on (docs/decisions/0052-technician-sessions.md).
//
// "His sessions are bound to a device and can be revoked by ops. Revoking also
// wipes the device's cached jobs on its next contact": a call from a revoked
// phone is answered `device_revoked`, and the app drops what it cached.

import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../app.ts";
import { findSession, revokeSession, SESSION_TOUCH_MS, SESSION_TTL_MS, touchSession } from "../domain/sessions.ts";
import { deviceOfSession, markWiped, touchDevice } from "../domain/technicians.ts";
import { sha256Hex } from "../lib/hash.ts";
import { errorBody } from "./errors.ts";

export const TECHNICIAN_COOKIE = "mm_tech";

/** The technician this request is from, and the phone he is on. */
export interface TechnicianSession {
  readonly sessionId: string;
  readonly technicianId: string;
  /** The technician_devices row, not the phone's own ID. */
  readonly deviceRowId: string;
  readonly deviceId: string;
}

/** No Domain attribute: the cookie stays on the technician app's own host. */
export function setTechnicianCookie(c: Context<AppEnv>, token: string): void {
  setCookie(c, TECHNICIAN_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearTechnicianCookie(c: Context<AppEnv>): void {
  deleteCookie(c, TECHNICIAN_COOKIE, { path: "/", secure: true });
}

/**
 * Refuses a request without a live session on an enrolled phone, and moves the
 * session's expiry on (at most hourly). Sets c.var.technicianSession.
 */
export const requireTechnicianSession = createMiddleware<AppEnv>(async (c, next) => {
  const token = getCookie(c, TECHNICIAN_COOKIE);
  const now = c.var.deps.now();
  if (token === undefined || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return c.json(errorBody("session_required", c.var.requestId), 401);
  }

  // The device is read first: revoking one ends its session too, and a phone
  // that was revoked must hear so, not just that it is logged out.
  const device = await deviceOfSession(c.env.DB, await sha256Hex(token));
  if (device !== null && device.revokedAt !== null) {
    await markWiped(c.env.DB, device.id, now);
    clearTechnicianCookie(c);
    return c.json(errorBody("device_revoked", c.var.requestId), 401);
  }

  const session = await findSession(c.env.DB, "technician", token, now);
  if (session === null || device === null) return c.json(errorBody("session_required", c.var.requestId), 401);

  // One FSM no longer lists as active has left, and his phone still holds clients'
  // addresses: the session ends here, and the app wipes what it holds on the 401.
  if (!device.technicianActive) {
    await revokeSession(c.env.DB, session.id, now);
    clearTechnicianCookie(c);
    return c.json(errorBody("session_required", c.var.requestId), 401);
  }

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
