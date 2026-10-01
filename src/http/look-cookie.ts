// The try-on's cookie, mm_look: it names the browser's render, signed so it
// cannot be made up, and keeps the browser to one look. It never opens the look
// itself, which goes to WhatsApp only
// (docs/decisions/0104-the-try-ons-look-on-whatsapp-only.md).

import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "./context.ts";
import { LOOK_COOKIE, LOOK_COOKIE_TTL_MS } from "../config/tryon.ts";
import { signToken, verifyToken } from "../lib/signed-token.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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
