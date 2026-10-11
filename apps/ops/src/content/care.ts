// The Care inbox's words (Customer Care; docs/decisions/0129-the-care-inbox.md). The page imports them itself, so
// they stay out of the console's first load.

import { FAILED, NOT_PERMITTED, OFFLINE } from "./common.ts";

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
    notSent: "Not sent",
  },
  compose: {
    label: "Reply",
    send: "Send",
    sending: "Sending",
    note: "Add note",
    reason: "What it was about",
    closeChat: "Close chat",
    sent: "Sent.",
    noted: "Note added.",
    closed: "Chat closed.",
    failed: "WhatsApp did not take it. It is kept in the chat as not sent.",
  },
  reasons: {
    booking: "Booking",
    move_or_cancel: "Move or cancel",
    fit_problem: "Fit problem",
    aftercare: "Aftercare",
    billing: "Billing",
    sign_in: "Signing in",
    try_on: "Try-on",
    data_request: "Their data",
    other: "Other",
  },
  errors: {
    text: "Write something first.",
    unavailable: "Replies wait for the office number on MSG91.",
    not_found: "Not found. Reload.",
    not_permitted: NOT_PERMITTED,
    offline: OFFLINE,
    unknown: FAILED,
  },
};
