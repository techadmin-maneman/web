// A record one of our own scripts or fixtures wrote for staging, never a real client or technician's
// (docs/decisions/0025-phase-2-conflicts-register.md, item 84; ADR 0097's refinement of 30 September 2026).
//
// Separate from the messaging classification (src/config/message-templates.ts), which decides by the message's
// kind: this decides by who it is about. Our own scripts invent a client or technician with a random
// 9xxxxxxxxx number, very likely a real person's, since India publishes no reserved test range for mobiles.
// Every one of them names its invented record "Staging test" or "Load test", and a record so named when it is made
// on staging is marked a test record, on the person (people.test_record). The mark is read from there, never from the
// name again, so a rename can make nothing a test record that was not one (the owner's decision 23 of 2 Oct 2026).

import type { EnvironmentName } from "../config/environments.ts";
import { onAllowlist, type MessagingSettings } from "../config/settings.ts";
import { isStagingTestName } from "../lib/test-names.ts";

export const RULES = [
  "A record one of our own scripts made is messaged only if its number is on the allowlist, whatever the message's class.",
  "On staging, a test record signs in with the known code in STAGING_TEST_RECORD_CODE, and skips the limits per address.",
  "A test record's name is shown without its mark, as a real person's name would be.",
  "Razorpay texts a payment link, and its reminders, only to a number on the allowlist. Production has no allowlist, so every client is texted.",
] as const;

/** Whether a person made now, with this name, is a test record: on staging alone, and so named. */
export const testRecordAtCreation = (environment: EnvironmentName | undefined, name: string): boolean =>
  environment === "staging" && isStagingTestName(name);

/**
 * Whether a test run on staging may skip the limits per address (IP) for this record: an audit books and signs in
 * many test records from one machine, where real clients come from many. The limits per number still apply.
 */
export function skipsAddressLimits(environment: EnvironmentName | undefined, testRecord: boolean): boolean {
  return environment === "staging" && testRecord;
}

/**
 * Whether staging's allowlist holds back what would go to this number: an automatic message (a reminder, or one to
 * someone other than who acted; MESSAGE_CLASSES, src/config/message-templates.ts), or anything to a test record, off
 * the allowlist (ADR 0097). A login code is never automatic. Production's allowlist is empty, so nothing is held back.
 */
export function heldBack(
  messaging: MessagingSettings,
  sent: { readonly automatic: boolean; readonly testRecord: boolean; readonly mobileE164: string },
): boolean {
  return (sent.automatic || sent.testRecord) && !onAllowlist(messaging, sent.mobileE164);
}
