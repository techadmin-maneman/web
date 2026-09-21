// The try-on's two cookies. mm_tryon, set by the gate, lets a person see their
// result for 30 minutes; its value is the session's ID, and D1 says what it
// may see. mm_look names the browser's render, for one look per visitor.

import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "../app.ts";
import { LOOK_COOKIE, LOOK_COOKIE_TTL_MS, SESSION_COOKIE, SESSION_TTL_MS } from "../config/tryon.ts";
import { loadSession, type SessionRow } from "../domain/tryon.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The visitor's session, if their cookie names one that has not expired. */
export async function currentSession(c: Context<AppEnv>): Promise<SessionRow | null> {
  const sessionId = getCookie(c, SESSION_COOKIE);
  if (sessionId === undefined || !UUID.test(sessionId)) return null;
  return loadSession(c.env.DB, sessionId, c.var.deps.now());
}

export function setSessionCookie(c: Context<AppEnv>, sessionId: string): void {
  setCookie(c, SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/api/tryon",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

/**
 * The mm_look cookie names the browser's last render, so it gets one look.
 * Best-effort only: clearing cookies gets round it. The daily ceiling is the
 * hard limit on spend.
 */
export function setLookCookie(c: Context<AppEnv>, jobId: string): void {
  setCookie(c, LOOK_COOKIE, jobId, {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/api/tryon",
    maxAge: LOOK_COOKIE_TTL_MS / 1000,
  });
}

/** The job the browser's mm_look cookie names, if it is a UUID. */
export function lookCookieJob(c: Context<AppEnv>): string | null {
  const jobId = getCookie(c, LOOK_COOKIE);
  return jobId !== undefined && UUID.test(jobId) ? jobId : null;
}
