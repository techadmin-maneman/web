// Areas (board C3): the waitlist by area, a launch, and the pincodes we serve.

import { NOT_PERMITTED } from "./common.ts";

/**
 * Areas, under Growth: who waits in each pincode, and every pincode we hold. Both tabs mark a pincode live through
 * one panel, which says who it messages before anything is sent.
 */
export const areas = {
  title: "Areas",
  /** No board draws Areas. Waiting is board C3's waitlist; Served was Settings · Service area. */
  tabs: { waiting: "Waiting", served: "Served" },
  /** Served for a person whose Growth access is not national. */
  servedClosed: "Served lists every pincode in every city, so it needs Growth access nationally.",
  /** The board's launch panel (C3), for a pincode chosen on Waiting and for a save on Served alike. */
  launch: {
    label: (pincode: string) => `Mark ${pincode} live`,
    /** The panel's head for a pincode already live. */
    tellLabel: (pincode: string) => `Tell those waiting in ${pincode}`,
    /** The panel's head for a save on Served that marks several pincodes live. */
    manyLabel: (count: number) => `Mark ${String(count)} pincodes live`,
    title: (alerts: number) =>
      alerts === 0 ? "This messages nobody" : `This messages ${String(alerts)} ${alerts === 1 ? "person" : "people"}`,
    rows: { waiting: "On the list", alerts: "Asked to be told", referred: "Came by referral" },
    /** One line a pincode, for a save on Served. */
    line: (pincode: string, area: string, people: number) =>
      `${pincode}, ${area}: ${String(people)} waiting ${people === 1 ? "asks" : "ask"} to be told.`,
    /**
     * What each of them gets. The words are launch_alert_v1's in
     * src/config/message-templates.ts, which is what the queue actually sends;
     * the first name is theirs, so the preview shows the placeholder.
     * test/node/ops-content.test.ts holds the two together.
     */
    message: (area: string, bookingUrl: string) =>
      `Hi {first name}, Mane Man now comes to ${area}. Book your free consultation: ${bookingUrl}`,
    /** The area a message about several pincodes names, each its own. */
    eachArea: "{area}",
    /** The board's "Send to 84"; with nobody to message, the press only marks the pincode live, and says so. */
    send: (alerts: number) => (alerts === 0 ? "Mark it live" : `Send to ${String(alerts)}`),
    /** A save on Served sends every change in the table with the messages. */
    saveAndSend: (alerts: number) => `Save and send to ${String(alerts)}`,
    sending: "Sending",
    cancel: "Not now",
    /** The board's note beneath the panel, with the figures filled in. */
    note: (quiet: number) => {
      if (quiet === 0) return "Everyone on the list asked to be told.";
      const who = quiet === 1 ? "The 1 who did not opt in is" : `The ${String(quiet)} who did not opt in are`;
      return `${who} not messaged. The count shows both so the gap is visible.`;
    },
    /** For a pincode already live, those not messaged include whoever was told before. */
    toldNote: "Nobody who has been told is told again.",
    done: (alerts: number) =>
      alerts === 0 ? "Marked live. Nobody was messaged." : `Launched. ${String(alerts)} on their way.`,
    errors: {
      not_permitted: NOT_PERMITTED,
      not_found: "We do not hold that pincode. Add it first.",
      launch_in_future: "A pincode goes live today or from a day already past, never one to come.",
      offline: "You are offline. Connect, then try again.",
      unknown: "That did not go through. Please try again.",
    } as Readonly<Record<string, string>>,
  },
  /** Our words, all of them: adding a pincode the service area does not hold, on Waiting and on Served. */
  add: {
    /** The panel's head on Waiting. */
    label: (pincode: string) => `Add ${pincode}`,
    /** Served's own way in. */
    title: "Add a pincode",
    note: "It goes in unserved. Marking it live comes next, and says first who it messages.",
    pincode: "Pincode",
    area: "Area, as messages name it",
    city: "City",
    chooseCity: "Choose a city",
    noCity: "Your access reaches no city to add a pincode in.",
    add: "Add it",
    adding: "Adding",
    added: (pincode: string, city: string) =>
      `${pincode} is in ${city} now, not served yet. Tick Served and save to mark it live.`,
    badPincode: "A pincode is six digits and starts with 1 to 8.",
    badName: "An area's name starts with a letter or a digit and runs from 2 to 40 characters.",
    errors: {
      pincode_held: "We hold that pincode already.",
      invalid_request: "Check the pincode, the area's name and the city.",
      not_permitted: NOT_PERMITTED,
      offline: "You are offline. Connect, then try again.",
      unknown: "That did not go through. Nothing was added.",
    } as Readonly<Record<string, string>>,
  },
  served: {
    title: "Every pincode we hold",
    /**
     * The file is what the owner already edits (data/pincodes/README.md), so
     * the screen takes it back rather than asking for 198 rows to be retyped.
     * The rows are for the one-at-a-time change, which is what a launch is.
     */
    note: "Change a pincode here, or download the list, edit it in a spreadsheet and upload it again.",
    city: (city: string, served: number, all: number) => `${city} · ${String(served)} of ${String(all)}`,
    columns: ["Pincode", "Area, as messages name it", "Served", "Launch date", "Waiting"],
    areaLabel: (pincode: string) => `Area name for ${pincode}`,
    served: (pincode: string) => `Served ${pincode}`,
    launchOn: (pincode: string) => `Launch date for ${pincode}`,
    /** Beneath the table: what the two boxes of a row mean. */
    hint:
      "The area's name is what a launch message, the waitlist and the dispatch board call it. " +
      "A held referral invite for an area lapses twelve months from its launch date.",
    /** The name a row's box holds: a letter or a digit first, as the API takes it. */
    badName: (pincode: string) =>
      `${pincode}: an area's name starts with a letter or a digit and runs from 2 to 40 characters.`,
    save: "Save these pincodes",
    saving: "Saving",
    saved: (changed: number, alerted: number) => {
      const pincodes = changed === 1 ? "One pincode changed." : `${String(changed)} pincodes changed.`;
      if (alerted === 0) return pincodes;
      return `${pincodes} ${String(alerted)} ${alerted === 1 ? "person is" : "people are"} being told on WhatsApp.`;
    },
    nothing: "Nothing to save: no pincode has changed.",
    /** A row that would serve a pincode from a day still to come, which /book would take bookings for at once. */
    later: (pincode: string) => `${pincode}: a pincode goes live today or from a day already past, never one to come.`,
    bulk: {
      serve: (city: string) => `Serve all of ${city}`,
      stop: (city: string) => `Stop serving ${city}`,
    },
    upload: {
      title: "Upload the file",
      label: "The CSV you have edited",
      hint:
        "It needs pincode, served and launch_on columns; every other column is ignored. " +
        "Served is yes or no, and a blank is no. A launch date is written 2026-10-01.",
      /** What the file would change, pincode by pincode, before any of it is taken. */
      read: (changed: number) =>
        changed === 1 ? "The file changes one pincode:" : `The file changes ${String(changed)} pincodes:`,
      columns: ["Pincode", "Area", "Now", "In the file"],
      state: (served: boolean, launch: string | null) => {
        const serving = served ? "Served" : "Not served";
        return launch === null ? serving : `${serving}, launch ${launch}`;
      },
      none: "The file changes nothing. Every pincode in it already reads that way.",
      apply: "Put these in the table",
      applied: "The file's changes are in the table. Check them, then save.",
      cancel: "Not now",
      badDate: (pincode: string) => `${pincode}: a launch date has to be written as 2026-10-01.`,
      badServed: (pincode: string) => `${pincode}: served has to be yes or no.`,
      badHeader: "That file needs a pincode, a served and a launch_on column. Save it as CSV, with its header row.",
    },
    download: "Download the current list",
    downloadName: "service-area.csv",
    errors: {
      not_permitted: NOT_PERMITTED,
      no_service_area: "That would leave no pincode served, and every client on the waitlist. Nothing was changed.",
      launch_in_future: "A pincode goes live today or from a day already past, never one to come. Nothing was changed.",
      /** A pincode we do not hold: one is added below, never by the file. */
      invalid_request: "That names a pincode we do not hold. Add it first. Nothing was changed.",
      offline: "You are offline. Connect, then try again.",
      unknown: "That did not go through. Nothing was changed.",
    } as Readonly<Record<string, string>>,
  },
} as const;

/** Areas' Waiting tab, board C3: who waits in each pincode, the longest wait first. */
export const waitlist = {
  columns: ["Pincode", "Area", "Count", "Oldest", "Came by referral", "Asked to be told"],
  /** An area or a date the pincode table has nothing for, written as the design's tables write a gap. */
  unknown: "—",
  /** A pincode the service area does not hold, which is added before it is marked live. */
  notHeld: "Not in the service area",
  /** A pincode we already come to. Our words: the board draws only those waiting. */
  live: "Live",
  choose: (pincode: string, area: string) => `Mark ${pincode} live, ${area}`,
  /**
   * A pincode served without its waitlist being told, as the
   * Settings screen served them until it launched them too (FEO-02). Choosing
   * it asks who is still to be told.
   */
  tell: (pincode: string, area: string) => `Tell those waiting in ${pincode}, ${area}`,
  /** Choosing a pincode the service area does not hold. */
  add: (pincode: string) => `Add ${pincode}, then mark it live`,
  // The board draws no empty waitlist.
  empty: "Nobody is waiting outside the areas we serve.",
  // The table lists the two hundred pincodes that have waited longest.
  more: "More pincodes have people waiting than are listed. These are the ones who have waited longest.",
  /** The board's launch sends today; the API takes the day a technician started coming. */
  date: "Launch date",
  dateHint:
    "Today, or the day a technician started coming if earlier. A held referral invite lapses twelve months from it.",
  /** Where the area's name in the message comes from, and where it is changed (OPS-13). */
  named: "The message names the area as Served names it, or its city until then.",
  rename: "Change the name",
} as const;
