// The client app's session, from its cookie, mm_app (src/http/session-cookie.ts).

import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "./context.ts";
import { findSession, SESSION_TOUCH_MS, touchSession, type Session } from "../domain/sessions.ts";
import { refuse } from "./errors.ts";
import { sessionCookie } from "./session-cookie.ts";

const CLIENT = sessionCookie("__Host-mm_app", "mm_app");

export const setClientCookie = CLIENT.set;
export const clearClientCookie = CLIENT.clear;

/** The session the request's cookie names, if it is live. */
export async function clientSessionOf(c: Context<AppEnv>): Promise<Session | null> {
  const token = CLIENT.tokenOf(c);
  if (token === null) return null;
  return findSession(c.env.DB, "client", token, c.var.deps.now());
}

/**
 * Refuses a request without a live session, and moves the session's expiry on
 * (at most hourly). Sets c.var.clientSession.
 */
export const requireClientSession = createMiddleware<AppEnv>(async (c, next) => {
  const session = await clientSessionOf(c);
  if (session === null) return refuse(c, "session_required");

  const now = c.var.deps.now();
  if (now.getTime() - session.lastSeenAt.getTime() > SESSION_TOUCH_MS) {
    await touchSession(c.env.DB, session, now);
    const token = CLIENT.tokenOf(c);
    if (token !== null) setClientCookie(c, token);
  }
  c.set("clientSession", session);
  return next();
});

/** The signed-in client's session; requireClientSession has set it on every route that asks. */
export function clientOf(c: Context<AppEnv>): Session {
  const session = c.var.clientSession;
  if (session === undefined) throw new Error("client routes run after requireClientSession");
  return session;
}
