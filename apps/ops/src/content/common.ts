// The console's words every screen may use: a refusal of access, an erased client, the loading and failure lines,
// and the site's booking page a launch sends people to.

import type { EnvironmentName } from "@rules/config/environments.ts";

/** The words of the shared parts (@maneman/ui/words), which every screen may use too. */
export {
  firstShown,
  LIST_TOOLS,
  CLOSE,
  changed,
  isChanged,
  LATEST,
  EDITING,
  broken,
  states,
  tables,
  deleting,
  review,
} from "@maneman/ui/words";

/**
 * A slot the redesign added whose words are still to be written (design/ops-redesign/COPY-TODO.md). It is drawn as
 * nothing until they are, so it never reaches a release (ADR 0225).
 */
export const TODO_COPY = "TODO(copy)";

/** The words, or nothing while they are still to be written. */
export const written = (words: string): string | undefined => (words === TODO_COPY ? undefined : words);

/** The public site's booking page, which a launch alert sends people to, as apps/app/src/content.ts has it. */
export const BOOKING_URL: Readonly<Record<EnvironmentName, string>> = {
  local: "http://127.0.0.1:4321/book",
  staging: "https://staging.maneman.in/book",
  production: "https://maneman.in/book",
};

/** The API refused a call the person's access does not reach. */
export const NOT_PERMITTED = "Your access doesn’t include this. Ask an admin.";

/** No connection: the call never reached the API. */
export const OFFLINE = "You’re offline. Reconnect and try again.";

/** A change whose answer never came: it may have gone through, and the same change sent again is not made twice. */
export const UNCONFIRMED = "We couldn’t confirm that went through. Check before trying again.";

/** A refusal with no words of its own. */
export const FAILED = "That didn’t work. Try again.";

/** A length of time as the console writes it: "1 h 30 min", "45 min", "3 h". */
export function hoursAndMinutes(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${String(minutes)} min`;
  return minutes === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(minutes)} min`;
}

/** Razorpay not answering, wherever a payment, refund or link waits on it. */
export const RAZORPAY_DOWN = "Razorpay isn’t responding. Try again in a minute.";

/** Shown wherever a number would be, for a client erased since, whose number is gone. */
export const ERASED_MOBILE = "Erased client";
