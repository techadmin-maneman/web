// What the site's forms, the try-on and the client app's login check about the
// visitor: their address, kept only as a salted hash, and their Turnstile token.

import type { Context } from "hono";
import type { AppEnv } from "./context.ts";
import { TURNSTILE_HOSTS } from "../config/environments.ts";
import { countOne } from "../domain/sign-in/rate-limit.ts";
import { saltedHash } from "../lib/hash.ts";
import { TURNSTILE_TEST_TOKEN, verifyTurnstile, type TurnstileResult } from "../providers/turnstile.ts";

interface Visitor {
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
export async function checkTurnstile(c: Context<AppEnv>, token: string, visitor: Visitor): Promise<TurnstileResult> {
  const { settings, environment } = c.var.config;
  if (settings.acceptTurnstileTestToken && token === TURNSTILE_TEST_TOKEN) return "passed";
  const verdict = await verifyTurnstile({
    secret: settings.turnstileSecret,
    token,
    ip: visitor.ip,
    hosts: environment === "local" ? null : TURNSTILE_HOSTS[environment],
    fetch: c.var.deps.fetch,
    log: c.var.log,
  });
  if (verdict.result === "unavailable") await countUnavailable(c, verdict.detail);
  else await c.var.deps.resolveAlert(TURNSTILE_UNAVAILABLE);
  return verdict.result;
}

/** Visitors turned away in one hour before ops are told: one is a blip, five is an outage. */
const UNAVAILABLE_PER_HOUR_TO_ALERT = 5;

const TURNSTILE_UNAVAILABLE = "turnstile_unavailable";

/**
 * Turnstile unavailable turns every lead, try-on and client login away (ADR 0011), so it is
 * logged, counted by the hour, and told to ops; the alert closes once Turnstile answers again
 * (docs/decisions/0067-alerts-and-silent-failures.md).
 */
async function countUnavailable(c: Context<AppEnv>, detail: string): Promise<void> {
  const { deps, log } = c.var;
  log.warn("turnstile_unavailable", { detail, check: "TURNSTILE_SECRET" });
  const now = deps.now();
  const failed = await countOne(c.env.DB, "turnstile_unavailable", "all", now);
  if (failed < UNAVAILABLE_PER_HOUR_TO_ALERT) return;
  await deps.alertOnce({
    key: TURNSTILE_UNAVAILABLE,
    message:
      `Turnstile could not check ${String(failed)} visitors in the last hour (${detail}), so their bookings, ` +
      "try-ons and app logins were turned away. Check Cloudflare's status, and the Turnstile secret the API is set up with.",
  });
}
