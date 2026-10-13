// The console's words every screen may use: a refusal of access, an erased client, the loading and failure lines,
// and the site's booking page a launch sends people to.

import type { EnvironmentName } from "@rules/config/environments.ts";

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

/** A change whose answer never came: it may have gone through, and the same change sent again is not made twice. */
export const UNCONFIRMED = "We couldn't confirm that went through. Check before trying again.";

/** A refusal with no words of its own. */
export const FAILED = "That didn't work. Try again.";

/** Shown wherever a number would be, for a client erased since, whose number is gone. */
export const ERASED_MOBILE = "Erased client";

/** What stands in for a page that failed to draw (../states/ErrorBoundary.tsx). */
export const broken = {
  message: "This page didn't open.",
  reload: "Reload",
  home: "Open the console",
} as const;

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

/** Deleting something added by mistake: asked once, then gone for good (../components/DeleteAction.tsx). */
export const deleting = {
  open: "Delete",
  label: (name: string) => `Delete ${name}`,
  warning: (name: string) => `Delete ${name}? This can't be undone.`,
  confirm: "Delete permanently",
  sending: "Deleting",
  cancel: "Cancel",
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
  sending: "Saving",
  edit: "Edit",
  cancel: "Cancel",
  nothing: "No changes.",
} as const;
