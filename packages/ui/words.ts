// The words of the shared parts every app's screens draw on (docs/decisions/0208-the-console-redesigned.md): a drawer's
// close, a list's search and pages, a value changed where it reads, a page that did not draw, loading and failure, a long
// table's tools, deleting, and the check before a change is sent. One place, so every screen says them the same way.

import { quantity } from "@maneman/web-kit/figures";

/** Beneath a list that stops at its first so many. */
export const firstShown = (count: number) => `Showing the first ${String(count)}`;

/** A long list's search and pages (./ListTools.tsx). */
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

/** The refusals that say what was acted on had changed or gone since the page opened. */
const CHANGED = new Set<string>();

/**
 * A refusal because what ops acted on had changed or gone since the page opened: the page reads itself again, and its
 * frame says this with LATEST after it (./Refusal.tsx).
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

/** What stands in for a page that failed to draw (./ErrorBoundary.tsx). */
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

/** A long table's search, its lists, its count and its next page (./TableTools.tsx). */
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

/** Deleting something added by mistake: asked once, then gone for good (./DeleteAction.tsx). */
export const deleting = {
  open: "Delete",
  label: (name: string) => `Delete ${name}`,
  warning: (name: string) => `Delete ${name}? This can’t be undone.`,
  confirm: "Delete",
  sending: "Deleting…",
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
  nothing: "No changes.",
} as const;

/** Beneath a box for someone's own words, how much room is left (./WordsField.tsx). */
export const charactersLeft = (count: number) =>
  count === 1 ? "1 character left" : `${String(count)} characters left`;

/**
 * The ways out of a form or a question, said the same everywhere (./CancelButton.tsx): Cancel; Keep it, where what is
 * asked is itself a cancelling or a withdrawal, so "Cancel" would read as going ahead; and Back, a step to what came
 * before.
 */
export const DISMISS = { cancel: "Cancel", keep: "Keep it", back: "Back" } as const;
