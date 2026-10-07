// Technicians: the roster, a technician's page, their leave and phones, and the waiting list's line.

import { FAILED, NOT_PERMITTED, OFFLINE } from "./common.ts";

/**
 * The Technicians roster. The design draws five columns; four are answered, and the
 * fifth, Skill, is recorded nowhere (docs/open-points.md, item 59). The phones
 * the board does not draw sit beneath each name.
 */
export const technicians = {
  title: "Technicians",
  /**
   * Four of the design's five columns, and Leave where it draws Skill: nothing
   * records a skill, and a day off is what ops need to see down the roster.
   */
  columns: ["Technician", "Zone", "Jobs", "Avg service", "Leave"],
  narrow: "Filter technicians",
  /** The Leave column: away today until when, the first day of leave to come, or nothing. */
  away: (until: string) => `Away to ${until}`,
  from: (date: string) => `From ${date}`,
  /** A zone a technician has none of, written as the design's tables write a gap. */
  unknown: "—",
  // The board draws no console without technicians.
  empty: "No active technicians.",
  /** The two columns counted from the jobs themselves (src/domain/dispatch/technician-work.ts). */
  work: {
    /** The average itself, as the board writes it: "1 h 24 m", and "48 m" under the hour. */
    average: (hours: number, minutes: number) => {
      if (hours === 0) return `${String(minutes)} m`;
      if (minutes === 0) return `${String(hours)} h`;
      return `${String(hours)} h ${String(minutes)} m`;
    },
    /** When the phone timed fewer jobs than were finished, the average says what it is of. */
    base: (timed: number, jobs: number) => `${String(timed)} of ${String(jobs)}`,
    /** Beneath the table, where the board writes its own note: what the two columns count. */
    period: (from: string, to: string) => `Jobs finished ${from} to ${to}.`,
    /** The board's fifth column, which no route can answer (docs/open-points.md, item 59). */
  },
  /** Our words, all of them: the board draws the roster and no page for one technician. */
  page: {
    back: "All technicians",
    tabsLabel: (name: string) => `${name}: week, leave, phones and kit`,
    notFound: "No longer on the roster.",
  },
  tabs: { week: "This week", leave: "Leave", phones: "Phones", kit: "Kit" },
  week: {
    open: "Open on the board",
  },
  kit: {
    columns: ["Consumable", "Held", "Last counted"],
    none: "Kit is empty.",
    stock: "Record a movement in Stock",
  },
  phones: {
    /** A phone whose browser gave no label at login. */
    unlabelled: "Phone",
    /**
     * "Chrome on Android · 3f9a": the browser, and the end of the
     * app's own ID for the phone, so two phones alike can be told apart.
     */
    label: (label: string, id: string) => `${label} · ${id}`,
    /** "Last used 22 Sep 2027, 10:30 am". */
    seen: (when: string) => `Last used ${when}`,
    signedIn: "Signed in",
    signedOut: "Signed out",
    none: "No phones signed in.",
    revoke: "Revoke",
    /** The button's whole name, since a roster holds many phones and each button says "Revoke". */
    revokeLabel: (phone: string, technician: string) => `Revoke ${phone} of ${technician}`,
    confirm: "Revoke this phone",
    cancel: "Cancel",
    revoking: "Revoking",
    revoked: (date: string) => `Revoked ${date}`,
    /** The board draws no revoke, so nothing writes what one does. */
    warning: "Signs the phone out. They can't sign in again until you allow it.",
    // The board draws no revoke, so nothing writes what follows one.
    stopped: (date: string) => `Sign-in blocked since ${date}, when a phone was revoked.`,
    allow: "Allow sign-in",
    allowing: "Allowing",
    allowed: "They can sign in again.",
    errors: {
      not_permitted: NOT_PERMITTED,
      not_found: "That phone is no longer theirs. Reload.",
      offline: OFFLINE,
      unknown: FAILED,
    } as Readonly<Record<string, string>>,
  },
  /**
   * The design draws no leave anywhere. Leave is recorded here
   * (ADR 0062), and every line below is ours.
   */
  leave: {
    none: "No leave recorded.",
    /** "19 Sep to 23 Sep", and "19 Sep" for a single day. */
    period: (from: string, to: string) => (from === to ? from : `${from} to ${to}`),
    add: "Record leave",
    addLabel: (technician: string) => `Record leave for ${technician}`,
    from: "First day",
    to: "Last day",
    note: "Note (optional)",
    save: "Record",
    saving: "Recording",
    cancel: "Cancel",
    /** Taking leave back, which lets those days be worked again, asked once more before it is sent. */
    take: "Cancel leave",
    takeLabel: (period: string, technician: string) => `Cancel ${technician}'s leave, ${period}`,
    check: {
      title: (period: string) => `Cancel leave, ${period}?`,
      line: "They can be booked on those days again.",
      send: "Cancel leave",
      sending: "Cancelling",
      back: "Keep leave",
    },
    recorded: "Leave recorded.",
    // Leave recorded over jobs already booked moves none of them.
    stranded: {
      title: (count: number) =>
        `${String(count)} ${count === 1 ? "job is" : "jobs are"} still booked on these days. Move ${count === 1 ? "it" : "them"} on the board.`,
      job: (when: string, client: string) => `${when} · ${client}`,
      noClient: "No client",
      show: "Show on board",
      showLabel: (when: string, client: string) => `Show on board: ${when} · ${client}`,
    },
    errors: {
      not_permitted: NOT_PERMITTED,
      invalid_request: "The last day must follow the first, within a year.",
      not_found: "No longer exists. Reload.",
      offline: OFFLINE,
      unknown: FAILED,
    },
  },
  // The board draws no way to add, change or switch off a technician, so every line below is ours.
  fields: {
    name: "Name",
    mobile: "Mobile",
    zone: "Zone (optional)",
    city: "City",
    noCity: "No city",
  },
  add: {
    open: "Add a technician",
    title: "Add a technician",
    save: "Add technician",
    saving: "Adding",
    cancel: "Cancel",
    added: (name: string) => `${name} added. They can sign in now.`,
  },
  details: {
    title: "Details",
    mobile: "Mobile",
    zone: "Zone",
    city: "City",
    change: "Edit details",
    changeLabel: (name: string) => `Edit ${name}'s details`,
    save: "Save",
    saving: "Saving",
    cancel: "Cancel",
  },
  /** A technician added by mistake; one with work on record is switched off instead. */
  inUse: "They have work on record. Switch them off instead.",
  switchOff: {
    open: "Switch off",
    openLabel: (name: string) => `Switch off ${name}`,
    warning: "Signs them out. Upcoming visits go back to the dispatch board.",
    confirm: "Switch off",
    sending: "Switching off",
    cancel: "Cancel",
    returned: (count: number) =>
      count === 0
        ? "No upcoming visits."
        : `${String(count)} ${count === 1 ? "visit is" : "visits are"} back on the dispatch board.`,
    visit: (when: string, client: string) => `${when} · ${client}`,
    noClient: "No client",
    move: "Reassign on the dispatch board",
  },
  switchOn: {
    note: "Switched off. Can't sign in or be booked.",
    open: "Switch back on",
    openLabel: (name: string) => `Switch ${name} back on`,
    sending: "Switching on",
    done: (name: string) => `${name} can sign in again.`,
  },
  switchedOff: "Switched off",
  /** Why an add, a change or a switch was refused; nothing changed either way. */
  errors: {
    number_in_use: "Another active technician signs in with that number.",
    number_in_use_now: "Another active technician now uses this number. Change one of them first.",
    unreadable_mobile: "Enter a 10-digit Indian mobile.",
    invalid_request: "Enter his name and a 10-digit Indian mobile.",
    not_found: "No longer on the roster. Reload.",
    not_permitted: NOT_PERMITTED,
    offline: OFFLINE,
    unknown: FAILED,
  },
} as const;

/*
 * The three sections a client's rights over their own data put in front of ops
 * (docs/decisions/0049-dpdp.md, docs/decisions/0042-client-profile.md). The
 * design draws no board for any of them — they came out of a proof on staging,
 * which found all three API-only — so every line below is a placeholder, and
 * each queue is built as the boards' own queues are (C1 and D1).
 */

/** How long something waiting on ops has left, on Tasks and in every queue: "2 days left", "3 days overdue". */
export const waiting = {
  left: (days: number) => `${String(days)} ${days === 1 ? "day" : "days"} left`,
  today: "Due today",
  over: (days: number) => `${String(days)} ${days === 1 ? "day" : "days"} overdue`,
} as const;
