// Technicians: the roster, a technician's page, their leave and phones, and the waiting list's line.

import { NOT_PERMITTED } from "./common.ts";

/**
 * Board D3's roster. The board draws five columns; four are answered, and the
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
  /** The Leave column: away today until when, the first day of leave to come, or nothing. */
  away: (until: string) => `Away to ${until}`,
  from: (date: string) => `From ${date}`,
  /** A zone a technician has none of, written as the design's tables write a gap. */
  unknown: "—",
  // The board draws no console without technicians.
  empty: "No technician is active.",
  /** The two columns counted from the jobs themselves (src/domain/technician-work.ts). */
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
    period: (from: string, to: string) =>
      `Jobs finished from ${from} to ${to}. Average service is against the length each visit was planned for, over the jobs the phone timed from Start to the outcome.`,
    /** The board's fifth column, which no route can answer (docs/open-points.md, item 59). */
  },
  /** Our words, all of them: the board draws the roster and no page for one technician. */
  page: {
    back: "All technicians",
    tabsLabel: (name: string) => `${name}: his week, leave, phones and kit`,
    notFound: "That technician is not on the roster any more.",
  },
  tabs: { week: "This week", leave: "Leave", phones: "Phones", kit: "Kit" },
  week: {
    lead: "His jobs this week are on the dispatch board, with his row alone in view.",
    open: "Open his week on the board",
  },
  kit: {
    lead: "What his kit holds, as the stock ledger counts it.",
    columns: ["Consumable", "Held", "Last counted"],
    none: "Nothing in his kit on record.",
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
    none: "No phone logged in.",
    revoke: "Revoke",
    /** The button's whole name, since a roster holds many phones and each button says "Revoke". */
    revokeLabel: (phone: string, technician: string) => `Revoke ${phone} of ${technician}`,
    confirm: "Revoke this phone",
    cancel: "Keep it",
    revoking: "Revoking",
    revoked: (date: string) => `Revoked ${date}`,
    /** The board draws no revoke, so nothing writes what one does. */
    warning:
      "The session ends, the phone drops its cached jobs when it is next online, and he cannot sign in again until you let him.",
    // The board draws no revoke, so nothing writes what follows one.
    stopped: (date: string) => `Sign-in stopped since ${date}, when a phone was revoked.`,
    allow: "Let him sign in again",
    allowing: "Letting him in",
    allowed: "He can sign in again.",
    errors: {
      not_permitted: NOT_PERMITTED,
      not_found: "That phone is not this technician's any more. Reload to see the roster as it stands.",
      offline: "You are offline. Connect, then try again.",
      unknown: "That did not go through. Please try again.",
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
    save: "Record it",
    saving: "Recording",
    cancel: "Cancel",
    /** Taking leave back, which lets those days be worked again, asked once more before it is sent. */
    take: "Take it back",
    takeLabel: (period: string, technician: string) => `Take back ${technician}'s leave, ${period}`,
    check: {
      title: (period: string) => `Take back leave, ${period}?`,
      line: "He can be booked again on those days.",
      send: "Take it back",
      sending: "Taking it back",
      back: "Keep the leave",
    },
    recorded: "Leave recorded.",
    effect: "Nobody can be booked or assigned on these days until the leave is taken back.",
    // Leave recorded over jobs already booked moves none of them.
    stranded: {
      title: (count: number) =>
        `${String(count)} ${count === 1 ? "job is" : "jobs are"} still booked on these days. Leave moves none.`,
      job: (when: string, client: string) => `${when} · ${client}`,
      noClient: "No client on our records",
      show: "Show on board",
      showLabel: (when: string, client: string) => `Show on board: ${when} · ${client}`,
    },
    errors: {
      not_permitted: NOT_PERMITTED,
      invalid_request:
        "Those dates do not work: the last day cannot come before the first, and leave runs a year at most.",
      not_found: "That technician or that leave is no longer here. Reload to see it as it stands.",
      offline: "You are offline. Connect, then try again.",
      unknown: "That did not go through. Please try again.",
    },
  },
  // The board draws no way to add, change or switch off a technician, so every line below is ours.
  fields: {
    name: "Name",
    mobile: "Mobile",
    zone: "Zone (optional)",
    city: "City",
    cityHint: "Staff with access to this city see him. With no city, only national staff do.",
    noCity: "No city",
  },
  add: {
    open: "Add a technician",
    title: "Add a technician",
    effect: "His sign-in codes go to this number on WhatsApp. He can sign in as soon as he is added.",
    save: "Add technician",
    saving: "Adding",
    cancel: "Cancel",
    added: (name: string) => `${name} is added. He can sign in now.`,
  },
  details: {
    title: "Details",
    mobile: "Mobile",
    zone: "Zone",
    city: "City",
    change: "Change details",
    changeLabel: (name: string) => `Change ${name}'s details`,
    save: "Save changes",
    saving: "Saving",
    cancel: "Cancel",
  },
  switchOff: {
    open: "Switch off",
    openLabel: (name: string) => `Switch off ${name}`,
    warning:
      "He is signed out at once and cannot sign in. His visits from now on go back on the dispatch board for someone else; a visit under way stays his.",
    confirm: "Switch him off",
    sending: "Switching off",
    cancel: "Keep him on",
    returned: (count: number) =>
      count === 0
        ? "He had no visits to come."
        : `${String(count)} ${count === 1 ? "visit is" : "visits are"} back on the dispatch board, for someone else.`,
    visit: (when: string, client: string) => `${when} · ${client}`,
    noClient: "No client on our records",
    move: "Give them out on the dispatch board",
  },
  switchOn: {
    note: "Switched off. He cannot sign in, and nothing is booked on him.",
    open: "Switch back on",
    openLabel: (name: string) => `Switch ${name} back on`,
    sending: "Switching on",
    done: (name: string) => `${name} can sign in again.`,
  },
  switchedOff: "Switched off",
  /** Why an add, a change or a switch was refused; nothing changed either way. */
  errors: {
    number_in_use: "Another active technician signs in with that number.",
    number_in_use_now: "Another active technician signs in with his number now. Change one of the two numbers first.",
    unreadable_mobile: "Enter a 10-digit Indian mobile.",
    invalid_request: "Enter his name and a 10-digit Indian mobile.",
    not_found: "That technician is no longer here. Reload to see the roster as it stands.",
    not_permitted: NOT_PERMITTED,
    offline: "You are offline. Connect, then try again.",
    unknown: "That did not go through. Please try again.",
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
