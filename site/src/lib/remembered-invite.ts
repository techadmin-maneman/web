// The invite a visitor last opened, remembered in this browser, so that a consultation or a place on a waitlist they
// ask for later on /book still carries it (docs/decisions/0089-an-invite-is-not-lost.md). Only a valid invite is
// remembered, the latest replacing any other, and it is forgotten once a booking has used it. Whether it applies is
// the API's to say, by the rules the landing's own booking follows.

const KEY = "mm_invite";
const DAY_MS = 86_400_000;
const CODE = /^[A-Z0-9]{4,12}$/;

/**
 * How long this browser remembers an invite once it is opened. It decides only that: who is attributed is the API's
 * rule, so this is not an ops setting (ADR 0089).
 */
export const INVITE_REMEMBERED_DAYS = 30;

interface Remembered {
  readonly code: string;
  readonly saved_at: string;
}

function isRemembered(value: unknown): value is Remembered {
  if (typeof value !== "object" || value === null) return false;
  const { code, saved_at: savedAt } = value as Record<string, unknown>;
  return typeof code === "string" && CODE.test(code) && typeof savedAt === "string";
}

function read(stored: string | null): Remembered | null {
  if (stored === null) return null;
  try {
    const parsed: unknown = JSON.parse(stored);
    return isRemembered(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** What is stored for an invite opened at `now`. */
export function remembering(code: string, now: Date): string {
  return JSON.stringify({ code: code.toUpperCase(), saved_at: now.toISOString() } satisfies Remembered);
}

/** The code a stored value names, while it is younger than INVITE_REMEMBERED_DAYS; otherwise null. */
export function codeIn(stored: string | null, now: Date): string | null {
  const remembered = read(stored);
  if (remembered === null) return null;
  const age = now.getTime() - Date.parse(remembered.saved_at);
  return age >= 0 && age < INVITE_REMEMBERED_DAYS * DAY_MS ? remembered.code : null;
}

/** Remembers a valid invite, in place of any other. */
export function rememberInvite(code: string): void {
  try {
    localStorage.setItem(KEY, remembering(code, new Date()));
  } catch {
    // Nothing is remembered; this page's own booking still carries its invite.
  }
}

/** The invite this browser remembers; null for none, one too old, or storage blocked. */
export function rememberedInvite(): string | null {
  try {
    return codeIn(localStorage.getItem(KEY), new Date());
  } catch {
    return null;
  }
}

/** Forgets the remembered invite once a booking or a place on a waitlist has carried it. */
export function forgetInvite(code: string): void {
  try {
    if (read(localStorage.getItem(KEY))?.code === code.toUpperCase()) localStorage.removeItem(KEY);
  } catch {
    // Storage is blocked, so nothing was remembered.
  }
}
