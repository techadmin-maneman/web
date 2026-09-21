// What the lead and try-on routes check about the visitor: their address, kept
// only as a salted hash, and their Turnstile token.

import type { Context } from "hono";
import type { AppEnv } from "../app.ts";
import { saltedHash } from "../lib/hash.ts";
import {
  TURNSTILE_ALWAYS_PASS_SECRET,
  TURNSTILE_TEST_TOKEN,
  verifyTurnstile,
  type TurnstileResult,
} from "../providers/turnstile.ts";

export interface Visitor {
  /** For Turnstile only; never stored or logged. */
  readonly ip: string | null;
  readonly ipHash: string;
}

export async function visitorOf(c: Context<AppEnv>): Promise<Visitor> {
  const ip = c.req.header("CF-Connecting-IP") ?? null;
  return { ip, ipHash: await saltedHash(c.var.config.settings.ipHashSalt, ip ?? "unknown") };
}

/** Staging also accepts Cloudflare's dummy token (docs/decisions/0011-lead-api.md). */
export function checkTurnstile(c: Context<AppEnv>, token: string, visitor: Visitor): Promise<TurnstileResult> {
  const { settings } = c.var.config;
  const isTestToken = settings.acceptTurnstileTestToken && token === TURNSTILE_TEST_TOKEN;
  return verifyTurnstile({
    secret: isTestToken ? TURNSTILE_ALWAYS_PASS_SECRET : settings.turnstileSecret,
    token,
    ip: visitor.ip,
    fetch: c.var.deps.fetch,
  });
}
