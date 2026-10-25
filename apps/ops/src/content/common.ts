// The console's words every screen may use: a refusal of access, an erased client, the loading and failure lines,
// and the site's booking page a launch sends people to.

import { quantity } from "@maneman/web-kit/figures";
import type { EnvironmentName } from "@rules/config/environments.ts";

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

/** Beneath a list that stops at its first so many. */
export const firstShown = (count: number) => `Showing the first ${String(count)}`;

/** A refusal with no words of its own. */
export const FAILED = "That didn’t work. Try again.";

/** A length of time as the console writes it: "1 h 30 min", "45 min", "3 h". */
export function hoursAndMinutes(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${String(minutes)} min`;
  return minutes === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(minutes)} min`;
}

/** A long list's search and pages (../components/ListTools.tsx). */
export const LIST_TOOLS = {
  matching: (count: number) => `${quantity(count)} ${count === 1 ? "match" : "matches"}`,
  none: (find: string) => `Nothing matches “${find}”.`,
  pages: {
    range: (from: number, to: number, total: number) => `${quantity(from)}–${quantity(to)} of ${quantity(total)}`,
    previous: "Previous page",
    next: "Next page",
  },
} as const;

/** What a drawer's cross is read as: never "Close" alone, which some forms use for closing days or a stockroom. */
export const CLOSE = "Close panel";

/** Razorpay not answering, wherever a payment, refund or link waits on it. */
export const RAZORPAY_DOWN = "Razorpay isn’t responding. Try again in a minute.";

/** The refusals that say what was acted on had changed or gone since the page opened. */
const CHANGED = new Set<string>();

/**
 * A refusal because what ops acted on had changed or gone since the page opened: the page reads itself again, and its
 * frame says this with LATEST after it (components/Refusal.tsx).
 */
export function changed(said: string): string {
  CHANGED.add(said);
  return said;
}

/** Whether a refusal's words are one `changed` named. */
export const isChanged = (said: string): boolean => CHANGED.has(said);

/** After a changed refusal, the page read again. */
export const LATEST = "Here’s the latest.";

/** What a value changed where it reads says (@maneman/ui/EditableRow). */
export const EDITING = { change: "Change", save: "Save", cancel: "Cancel", saved: "Saved" } as const;

/** Shown wherever a number would be, for a client erased since, whose number is gone. */
export const ERASED_MOBILE = "Erased client";

/** What stands in for a page that failed to draw (../states/ErrorBoundary.tsx). */
export const broken = {
  message: "This page didn’t open.",
  reload: "Reload",
  home: "Open the console",
} as const;

export const states = {
  loading: "Loading…",
  failed: "Couldn’t load this.",
  retry: "Try again",
  /** The failed call's reference, to quote to the developers. */
  ref: { label: "Ref", copy: "Copy", copied: "Copied" },
} as const;

/** A long table's search, its lists, its count and its next page (../components/TableTools.tsx). */
export const tables = {
  search: "Search",
  allOf: (column: string) => `${column}: All`,
  /** Every page's city list, unnarrowed, in the one wording. */
  allCities: "All cities",
  clear: "Clear",
  count: (matching: number, total: number) => `${String(matching)} of ${String(total)}`,
  none: "Nothing matches.",
  more: "Show more",
} as const;

/** Deleting something added by mistake: asked once, then gone for good (../components/DeleteAction.tsx). */
export const deleting = {
  open: "Delete",
  label: (name: string) => `Delete ${name}`,
  warning: (name: string) => `Delete ${name}? This can’t be undone.`,
  confirm: "Delete",
  sending: "Deleting…",
  cancel: "Cancel",
  /** A switch that reaches everyone asks for a word typed before it goes. */
  typeToConfirm: (word: string) => `Type ${word} to confirm`,
} as const;

/**
 * The one way a change is sent (docs/decisions/0071-what-ops-see-before-a-setting-changes.md): boxes, then Review,
 * then the change beside what it was, sent only by Confirm. A one-press action asks its question instead, and its
 * Cancel closes it. A change line reads "Field: was → now", with no full stop; a sentence keeps its own.
 */
export const review = {
  next: "Review",
  title: "Review the change",
  send: "Confirm",
  sending: "Saving…",
  edit: "Edit",
  cancel: "Cancel",
  nothing: "No changes.",
} as const;
