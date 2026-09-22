// The client app's session cookie, mm_app (docs/decisions/0029-sessions.md):
// host-only, HttpOnly, Secure, SameSite=Lax, 90 days from last use.

import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../app.ts";
import { findSession, SESSION_TOUCH_MS, SESSION_TTL_MS, touchSession, type Session } from "../domain/sessions.ts";
import { errorBody } from "./errors.ts";

export const CLIENT_COOKIE = "mm_app";

/** No Domain attribute: the cookie stays on the client app's own host. */
export function setClientCookie(c: Context<AppEnv>, token: string): void {
  setCookie(c, CLIENT_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearClientCookie(c: Context<AppEnv>): void {
  deleteCookie(c, CLIENT_COOKIE, { path: "/", secure: true });
}

/** The session the request's cookie names, if it is live. */
export async function clientSessionOf(c: Context<AppEnv>): Promise<Session | null> {
  const token = getCookie(c, CLIENT_COOKIE);
  if (token === undefined || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return findSession(c.env.DB, "client", token, c.var.deps.now());
}

/**
 * Refuses a request without a live session, and moves the session's expiry on
 * (at most hourly). Sets c.var.clientSession.
 */
export const requireClientSession = createMiddleware<AppEnv>(async (c, next) => {
  const session = await clientSessionOf(c);
  if (session === null) return c.json(errorBody("session_required", c.var.requestId), 401);

  const now = c.var.deps.now();
  if (now.getTime() - session.lastSeenAt.getTime() > SESSION_TOUCH_MS) {
    await touchSession(c.env.DB, session, now);
    const token = getCookie(c, CLIENT_COOKIE);
    if (token !== undefined) setClientCookie(c, token);
  }
  c.set("clientSession", session);
  return next();
});
