// The Care inbox's words (Customer Care; docs/decisions/0129-the-care-inbox.md). The page imports them itself, so
// they stay out of the console's first load.

import { FAILED, OFFLINE } from "./common.ts";

export const care = {
  title: "Messages",
  views: { open: "Waiting on us", waiting: "Waiting on the client", closed: "Closed", all: "All" },
  show: "Show",
  none: "No chats here.",
  columns: { client: "Client", number: "Number", said: "Last message", waiting: "Waiting", at: "Last", open: "Open" },
  unknown: "Number we don't know",
  waitingSince: (clock: string) => `Since ${clock}`,
  noLine: "Only our messages",
  open: "Open",
  openLabel: (who: string) => `Open the chat with ${who}`,
  thread: {
    title: (who: string) => `Chat with ${who}`,
    empty: "Nothing said yet.",
    client: "Client",
    note: "Note",
    erased: "Erased",
    /** "Visit reminder · delivered · read" */
    auto: (kind: string, seen: readonly string[]) => [kind, ...seen].join(" · "),
    delivered: "delivered",
    read: "read",
    queued: "waiting to send",
    close: "Close",
    page: "Client's page",
  },
  errors: { not_found: "Not found. Reload.", offline: OFFLINE, unknown: FAILED },
};
