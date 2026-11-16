// The issue log (design/client-redesign, the issue and raise screens; docs/decisions/0259-the-issue-log.md): what a
// client raised, where it stands, and what has been said about it.

import type { IssueEvent, ProblemAbout } from "../api.ts";

/** What a report is about, as the client picks it. */
export const ISSUE_CATEGORIES: Readonly<Record<Exclude<ProblemAbout, "hair_system">, string>> = {
  fit_guarantee: "The fit (guarantee)",
  edges_lifting: "Edges lifting",
  itching: "Itching or irritation",
  colour: "Colour or shine",
  shedding: "Shedding",
  fit_comfort: "Fit or comfort",
  visit: "A visit or technician",
  payment: "Payment or refund",
  other: "Something else",
};

export const issues = {
  states: { open: "Open", in_progress: "In progress", resolved: "Resolved" },
  /** What an issue that is not a report is. */
  kinds: { grievance: "A concern about your data", dispute: "A missed visit’s charge" },
  /** "MM-ISS-0001 · raised 14 Nov". */
  raised: (reference: string | null, date: string) =>
    reference === null ? `Raised ${date}` : `${reference} · raised ${date}`,
  none: {
    title: "No issues raised",
    line: "If something is off with your hair system, a visit or a payment, raise it here and track it to the end.",
  },
  kept: "Every issue you raise stays here with our replies and what was done.",
  report: "Report an issue",
  failed: "We couldn’t load your issues.",
  /** The issue's own page. */
  page: {
    linkedVisit: (date: string) => `Linked visit: ${date}`,
    log: "Log",
    waiting: "Waiting on Mane Man",
    resolved: "Resolved. If it comes back, reopen it and the history stays together.",
    again: "It’s happening again",
    againLabel: "What’s happening now",
    update: "Add an update",
    updatePlaceholder: "Anything new since you raised this",
    send: "Send update",
    sorted: "It’s sorted",
    reopen: "Reopen it",
    failed: "That didn’t go through. Try again.",
    notFound: "We couldn’t find this issue.",
  },
  /** Who said each line of an issue's log. */
  who: (event: IssueEvent): string => {
    switch (event.kind) {
      case "you":
        return "You";
      case "care":
        return event.name ?? "Mane Man";
      case "city":
        return "Passed to your city team";
      case "visits":
        return "Free service visits given";
      case "closed":
        return "Resolved";
      case "sorted":
        return "You marked it sorted";
      case "ruled":
        return "Our answer";
    }
  },
  /** A ruling's words, where they are a word for it. */
  ruled: { refunded: "Refunded", upheld: "The charge stands" } as Readonly<Record<string, string>>,
  /** Raising one. */
  raise: {
    about: "What’s it about?",
    what: "What’s happening?",
    whatHint: "When it started and what you notice",
    photos: "Photos",
    photosHint: "Optional, and they help us a lot",
    addPhotos: "Add photos",
    removePhoto: (n: number) => `Remove photo ${String(n)}`,
    visit: "Linked visit",
    visitHint: "Optional",
    noVisit: "Not about a visit",
    send: "Send to Mane Man",
    sending: "Sending…",
    failed: "That didn’t send. Try again.",
    limited: "You’ve reported a lot today. Message us on WhatsApp instead.",
    photoFailed: "Your report is in, but a photo didn’t upload. Add it from the issue.",
  },
} as const;
