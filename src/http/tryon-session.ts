// The try-on's two cookies. mm_tryon, set by the gate, lets a person see their
// result for 30 minutes; its value is the session's ID, and D1 says what it
// may see. mm_look names the browser's render, signed so it cannot be made
// up: it keeps the browser to one look, and lets it see that look again.

import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "./context.ts";
import { LOOK_COOKIE, LOOK_COOKIE_TTL_MS, SESSION_COOKIE, TRYON_SESSION_TTL_MS } from "../config/tryon.ts";
import { loadSession, type SessionRow } from "../domain/tryon.ts";
import { signToken, verifyToken } from "../lib/signed-token.ts";

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
    maxAge: TRYON_SESSION_TTL_MS / 1000,
  });
}

/**
 * The mm_look cookie names the browser's last render, so it gets one look.
 * Best-effort only: clearing cookies gets round it. The daily ceiling is the
 * hard limit on spend.
 */
export async function setLookCookie(c: Context<AppEnv>, jobId: string): Promise<void> {
  const expiresAt = new Date(c.var.deps.now().getTime() + LOOK_COOKIE_TTL_MS);
  const value = await signToken(c.var.config.settings.tryon.linkSigningKey, "look", jobId, expiresAt);
  setCookie(c, LOOK_COOKIE, value, {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/api/tryon",
    maxAge: LOOK_COOKIE_TTL_MS / 1000,
  });
}

/** The job the browser's mm_look cookie names, if the cookie is genuine and unexpired. */
export async function lookCookieJob(c: Context<AppEnv>): Promise<string | null> {
  const value = getCookie(c, LOOK_COOKIE);
  if (value === undefined) return null;
  const jobId = await verifyToken(c.var.config.settings.tryon.linkSigningKey, "look", value, c.var.deps.now());
  return jobId !== null && UUID.test(jobId) ? jobId : null;
}
