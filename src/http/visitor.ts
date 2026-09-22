// What the lead and try-on routes check about the visitor: their address, kept
// only as a salted hash, and their Turnstile token.

import type { Context } from "hono";
import type { AppEnv } from "../app.ts";
import { saltedHash } from "../lib/hash.ts";
import { TURNSTILE_TEST_TOKEN, verifyTurnstile, type TurnstileResult } from "../providers/turnstile.ts";

export interface Visitor {
  /** For Turnstile only; never stored or logged. */
  readonly ip: string | null;
  readonly ipHash: string;
}

export async function visitorOf(c: Context<AppEnv>): Promise<Visitor> {
  const ip = c.req.header("CF-Connecting-IP") ?? null;
  return { ip, ipHash: await saltedHash(c.var.config.settings.ipHashSalt, ip ?? "unknown") };
}

/**
 * Local and staging also accept Cloudflare's dummy token (docs/decisions/0011-lead-api.md),
 * and answer it here rather than asking Cloudflare: its test secret passes that token by
 * definition, so the round trip decides nothing and only adds an internet dependency. A slow
 * or refused siteverify answered "unavailable", which failed browser tests and staging proofs
 * for no reason of ours. Production never accepts the token (the guard refuses the switch),
 * and every real token is checked with the real secret, everywhere.
 */
export function checkTurnstile(c: Context<AppEnv>, token: string, visitor: Visitor): Promise<TurnstileResult> {
  const { settings } = c.var.config;
  if (settings.acceptTurnstileTestToken && token === TURNSTILE_TEST_TOKEN) return Promise.resolve("passed");
  return verifyTurnstile({
    secret: settings.turnstileSecret,
    token,
    ip: visitor.ip,
    fetch: c.var.deps.fetch,
  });
}
