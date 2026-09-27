// The login code (docs/prompts/phase2-backend.md, "Business rules, decided").
// The rules as the prompt states them, and the numbers they turn on (docs/decisions/0030-one-time-codes.md). A code is
// asked for and sent through src/http/send-code.ts, and checked, for a client and a technician alike, by
// src/domain/one-time-codes.ts.

import { MINUTE_MS } from "../lib/durations.ts";

export const RULES = [
  "Six digits, sent on WhatsApp.",
  "After 30 seconds the client may choose SMS instead.",
  "Five wrong attempts void the code.",
  "WhatsApp resend has a 30-second cooldown.",
] as const;

export const ONE_TIME_CODE = {
  digits: 6,
  smsOfferedAfterSeconds: 30,
  wrongAttemptsBeforeVoid: 5,
  whatsappResendCooldownSeconds: 30,
} as const;

/** A code works for ten minutes ("Endpoints": "code lifetime of 10 minutes"). */
export const CODE_TTL_MS = 10 * MINUTE_MS;
/** One challenge sends at most this many codes, whichever channel asks. */
export const MAX_SENDS_PER_CHALLENGE = 5;

/** Six random digits, each equally likely. */
export function newCode(): string {
  const limit = 4_294_000_000; // the largest multiple of 1,000,000 under 2^32, so no code is likelier than another
  const value = new Uint32Array(1);
  do crypto.getRandomValues(value);
  while ((value[0] ?? limit) >= limit);
  return String((value[0] ?? 0) % 1_000_000).padStart(ONE_TIME_CODE.digits, "0");
}

export function smsOfferedAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + ONE_TIME_CODE.smsOfferedAfterSeconds * 1000);
}

export function whatsappResendAt(lastSentAt: Date): Date {
  return new Date(lastSentAt.getTime() + ONE_TIME_CODE.whatsappResendCooldownSeconds * 1000);
}

/** Wrong attempts left before the code is void. */
export function attemptsLeft(attempts: number): number {
  return Math.max(0, ONE_TIME_CODE.wrongAttemptsBeforeVoid - attempts);
}
