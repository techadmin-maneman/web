// The try-on's cookie, mm_look: it names the browser's render, signed so it
// cannot be made up, and keeps the browser to one look. It never opens the look
// itself, which goes to WhatsApp only
// (docs/decisions/0104-the-try-ons-look-on-whatsapp-only.md).

import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "./context.ts";
import { LOOK_COOKIE } from "../config/tryon.ts";
import { DAY_MS } from "../lib/durations.ts";
import { opsInputs } from "./ops-inputs.ts";
import { signToken, verifyToken } from "../lib/signed-token.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The mm_look cookie names the browser's last render, so it gets one look in ops' days (`tryon_look_days`).
 * Best-effort only: clearing cookies gets round it. The daily ceiling is the
 * hard limit on spend.
 */
export async function setLookCookie(c: Context<AppEnv>, jobId: string): Promise<void> {
  const lastsMs = (await opsInputs(c)).tryonLookDays * DAY_MS;
  const expiresAt = new Date(c.var.deps.now().getTime() + lastsMs);
  const value = await signToken(c.var.config.settings.tryon.linkSigningKey, "look", jobId, expiresAt);
  setCookie(c, LOOK_COOKIE, value, {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/api/tryon",
    maxAge: lastsMs / 1000,
  });
}

/** The job the browser's mm_look cookie names, if the cookie is genuine and unexpired. */
export async function lookCookieJob(c: Context<AppEnv>): Promise<string | null> {
  const value = getCookie(c, LOOK_COOKIE);
  if (value === undefined) return null;
  const jobId = await verifyToken(c.var.config.settings.tryon.linkSigningKey, "look", value, c.var.deps.now());
  return jobId !== null && UUID.test(jobId) ? jobId : null;
}
