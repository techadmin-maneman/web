// The mm_tryon cookie: set by the gate, it lets a person see their results
// and ask for more looks for 30 minutes without passing the gate again. The
// value is the session's ID, a random UUID; D1 says what it may see.

import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "../app.ts";
import { SESSION_COOKIE, SESSION_TTL_MS } from "../config/tryon.ts";
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
