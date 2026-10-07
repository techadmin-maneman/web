// Areas: the waitlist by area, a launch, and the pincodes we serve.

import { FAILED, NOT_PERMITTED, OFFLINE } from "./common.ts";

/**
 * Areas, under Growth: who waits in each pincode, and every pincode we hold. Both tabs mark a pincode live through
 * one panel, which says who it messages before anything is sent.
 */
export const areas = {
  title: "Areas",
  /** Waiting is the design's waitlist; Served was Settings · Service area. */
  tabs: { waiting: "Waiting", served: "Served" },
  /** Served for a person whose Growth access is not national. */
  servedClosed: "Served needs national Growth access.",
  /** The launch panel, for a pincode chosen on Waiting and for a save on Served alike. */
  launch: {
    label: (pincode: string) => `Mark ${pincode} live`,
    /** The panel's head for a pincode already live. */
    tellLabel: (pincode: string) => `Tell those waiting in ${pincode}`,
    /** The panel's head for a save on Served that marks several pincodes live. */
    manyLabel: (count: number) => `Mark ${String(count)} pincodes live`,
    title: (alerts: number) =>
      alerts === 0 ? "No one will be messaged" : `Messages ${String(alerts)} ${alerts === 1 ? "person" : "people"}`,
    rows: { waiting: "Waiting", alerts: "Opted in", referred: "Referred" },
    /** One line a pincode, for a save on Served. */
    line: (pincode: string, area: string, people: number) => `${pincode}, ${area}: ${String(people)} opted in.`,
    /**
     * What each of them gets. The words are launch_alert_v1's in
     * src/config/message-templates.ts, which is what the queue actually sends;
     * the first name is theirs, so the preview shows the placeholder.
     * test/node/apps/ops/ops-content.test.ts holds the two together.
     */
    message: (area: string, bookingUrl: string) =>
      `Hi {first name}, Mane Man now comes to ${area}. Book your free consultation: ${bookingUrl}`,
    /** The area a message about several pincodes names, each its own. */
    eachArea: "{area}",
    /** The board's "Send to 84"; with nobody to message, the press only marks the pincode live, and says so. */
    send: (alerts: number) => (alerts === 0 ? "Mark live" : `Send to ${String(alerts)}`),
    /** A save on Served sends every change in the table with the messages. */
    saveAndSend: (alerts: number) => `Save and send to ${String(alerts)}`,
    sending: "Sending",
    cancel: "Cancel",
    /** The board's note beneath the panel, with the figures filled in. */
    note: (quiet: number) => {
      if (quiet === 0) return "Everyone waiting opted in.";
      return `${String(quiet)} didn't opt in and won't be messaged.`;
    },
    done: (alerts: number) => (alerts === 0 ? "Live. No one messaged." : `Live. ${String(alerts)} messages sent.`),
    errors: {
      not_permitted: NOT_PERMITTED,
      not_found: "Unknown pincode. Add it first.",
      launch_in_future: "The launch date must be today or earlier.",
      offline: OFFLINE,
      unknown: FAILED,
    } as Readonly<Record<string, string>>,
  },
  /** Our words, all of them: adding a pincode the service area does not hold, on Waiting and on Served. */
  add: {
    /** The panel's head on Waiting. */
    label: (pincode: string) => `Add ${pincode}`,
    /** Served's own way in. */
    title: "Add a pincode",
    pincode: "Pincode",
    area: "Area name",
    city: "City",
    chooseCity: "Choose a city",
    noCity: "Your access covers no city.",
    add: "Add",
    adding: "Adding",
    added: (pincode: string, city: string) => `${pincode} added to ${city}.`,
    badPincode: "Six digits, starting 1–8.",
    badName: "2–40 characters, starting with a letter or digit.",
    errors: {
      pincode_held: "Already added.",
      invalid_request: "Check the pincode, area name and city.",
      not_permitted: NOT_PERMITTED,
      offline: OFFLINE,
      unknown: FAILED,
    } as Readonly<Record<string, string>>,
  },
  served: {
    title: "All pincodes",
    /**
     * The file is the one already kept (data/pincodes/README.md), so
     * the screen takes it back rather than asking for 198 rows to be retyped.
     * The rows are for the one-at-a-time change, which is what a launch is.
     */
    city: (city: string, served: number, all: number) => `${city} · ${String(served)} of ${String(all)}`,
    columns: ["Pincode", "Area name", "Served", "Launch date", "Waiting"],
    narrow: "Filter pincodes",
    yes: "Yes",
    no: "No",
    areaLabel: (pincode: string) => `Area name for ${pincode}`,
    served: (pincode: string) => `Served ${pincode}`,
    launchOn: (pincode: string) => `Launch date for ${pincode}`,
    /** The name a row's box holds: a letter or a digit first, as the API takes it. */
    badName: (pincode: string) => `${pincode}: 2–40 characters, starting with a letter or digit.`,
    save: "Save",
    saving: "Saving",
    saved: (changed: number, alerted: number) => {
      const pincodes = changed === 1 ? "One pincode changed." : `${String(changed)} pincodes changed.`;
      if (alerted === 0) return pincodes;
      return `${pincodes} ${String(alerted)} WhatsApp ${alerted === 1 ? "message" : "messages"} sending.`;
    },
    nothing: "No changes.",
    /** A row that would serve a pincode from a day still to come, which /book would take bookings for at once. */
    later: (pincode: string) => `${pincode}: the launch date must be today or earlier.`,
    bulk: {
      serve: (city: string) => `Serve all of ${city}`,
      stop: (city: string) => `Stop serving ${city}`,
    },
    upload: {
      title: "Upload",
      label: "Edited CSV",
      hint: "Columns: pincode, served, launch_on.",
      /** What the file would change, pincode by pincode, before any of it is taken. */
      read: (changed: number) => (changed === 1 ? "1 pincode changes:" : `${String(changed)} pincodes change:`),
      columns: ["Pincode", "Area", "Now", "In the file"],
      state: (served: boolean, launch: string | null) => {
        const serving = served ? "Served" : "Not served";
        return launch === null ? serving : `${serving}, launch ${launch}`;
      },
      none: "No changes in the file.",
      apply: "Apply to table",
      applied: "Applied. Review, then save.",
      cancel: "Cancel",
      badDate: (pincode: string) => `${pincode}: write the date as 2026-10-01.`,
      badServed: (pincode: string) => `${pincode}: served must be yes or no.`,
      badHeader: "Needs pincode, served and launch_on columns.",
    },
    download: "Download CSV",
    downloadName: "service-area.csv",
    errors: {
      not_permitted: NOT_PERMITTED,
      no_service_area: "At least one pincode must stay served.",
      launch_in_future: "Launch dates must be today or earlier.",
      /** A pincode we do not hold: one is added below, never by the file. */
      invalid_request: "Unknown pincode. Add it first.",
      offline: OFFLINE,
      unknown: FAILED,
    } as Readonly<Record<string, string>>,
  },
} as const;

/** Areas' Waiting tab: who waits in each pincode, the longest wait first. */
export const waitlist = {
  columns: ["Pincode", "Area", "Waiting", "Oldest", "Referred", "Opted in"],
  narrow: "Filter the waitlist",
  /** An area or a date the pincode table has nothing for, written as the design's tables write a gap. */
  unknown: "—",
  /** A pincode the service area does not hold, which is added before it is marked live. */
  notHeld: "Not in service area",
  /** A pincode we already come to. Our words: the board draws only those waiting. */
  live: "Live",
  choose: (pincode: string, area: string) => `Mark ${pincode} live, ${area}`,
  /**
   * A pincode served without its waitlist being told, as the
   * Settings screen served them until it launched them too. Choosing
   * it asks who is still to be told.
   */
  tell: (pincode: string, area: string) => `Tell those waiting in ${pincode}, ${area}`,
  /** Choosing a pincode the service area does not hold. */
  add: (pincode: string) => `Add ${pincode}, then mark live`,
  // The board draws no empty waitlist.
  empty: "No one waiting.",
  // The table lists the two hundred pincodes that have waited longest.
  more: "Showing the longest waits only.",
  /** The board's launch sends today; the API takes the day a technician started coming. */
  date: "Launch date",
  rename: "Rename",
} as const;
