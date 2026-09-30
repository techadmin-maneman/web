// A record one of our own scripts or fixtures wrote for staging, never a real client or technician's
// (docs/decisions/0025-phase-2-conflicts-register.md, item 84; ADR 0097's refinement of 30 September 2026).
//
// Separate from the messaging classification (src/config/message-templates.ts), which decides by the message's
// kind: this decides by who it is about. Our own scripts invent a client or technician with a random
// 9xxxxxxxxx number, very likely a real person's, since India publishes no reserved test range for mobiles.
// Every one of them already names its invented record "Staging test" or "Load test", so that is the mark a test
// record carries and a real one never does.

export const RULES = [
  "A record one of our own scripts made is messaged only if its number is on the allowlist, whatever the message's class.",
] as const;

/** The names our own scripts and fixtures give an invented client or technician, never a real one's. */
const STAGING_TEST_NAME_PREFIXES = ["Staging test", "Load test"] as const;

/**
 * Whether this name marks a record one of our own scripts or fixtures wrote, not a real person or technician's.
 * Exactly one of the names above, or either followed by a word ("Staging test technician"), counts; nothing else
 * does, so a script that gives its invented record another name is the one that is wrong, not this check.
 */
export function isStagingTestRecord(name: string): boolean {
  return STAGING_TEST_NAME_PREFIXES.some((prefix) => name === prefix || name.startsWith(`${prefix} `));
}
