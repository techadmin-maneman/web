// The console's words every screen may use: a refusal of access, an erased client, the loading and failure lines,
// and the site's booking page a launch sends people to.

import type { EnvironmentName } from "../../../../src/config/environments.ts";

/** The public site's booking page, which a launch alert sends people to, as apps/app/src/content.ts has it. */
export const BOOKING_URL: Readonly<Record<EnvironmentName, string>> = {
  local: "http://127.0.0.1:4321/book",
  staging: "https://staging.maneman.in/book",
  production: "https://maneman.in/book",
};

/** The API refused a call the person's access does not reach. */
export const NOT_PERMITTED = "Your access doesn't include this. Ask an admin.";

/** No connection: the call never reached the API. */
export const OFFLINE = "You're offline. Reconnect and try again.";

/** A refusal with no words of its own. */
export const FAILED = "That didn't work. Try again.";

/** Shown wherever a number would be, for a client erased since, whose number is gone. */
export const ERASED_MOBILE = "Erased client";

export const states = {
  loading: "Loading",
  failed: "Couldn't load this.",
  retry: "Try again",
  /** The failed call's reference, to quote to the developers. */
  ref: { label: "Ref", copy: "Copy", copied: "Copied" },
} as const;

/** A long table's search, its lists, its count and its next page (../components/TableTools.tsx). */
export const tables = {
  search: "Search",
  all: "All",
  clear: "Clear",
  count: (matching: number, total: number) => `${String(matching)} of ${String(total)}`,
  none: "Nothing matches.",
  more: "Show more",
} as const;
