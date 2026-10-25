// Areas: the waitlist by area, a launch, and the pincodes we serve.

import { FAILED, NOT_PERMITTED, OFFLINE, UNCONFIRMED } from "./common.ts";

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
    sending: "Sending…",
    cancel: "Cancel",
    /** The board's note beneath the panel, with the figures filled in. */
    note: (quiet: number) => {
      if (quiet === 0) return "Everyone waiting opted in.";
      return `${String(quiet)} didn’t opt in and won’t be messaged.`;
    },
    done: (alerts: number) => (alerts === 0 ? "Live. No one messaged." : `Live. ${String(alerts)} messages sent.`),
    errors: {
      not_permitted: NOT_PERMITTED,
      not_found: "Unknown pincode. Add it first.",
      launch_in_future: "The launch date must be today or earlier.",
      no_technician: "No technician works in this city yet. Add one in Technicians first.",
      offline: OFFLINE,
      unconfirmed: UNCONFIRMED,
      unknown: FAILED,
    },
  },
  /** Opening a city from India Post's pincodes: a state, its districts, then the pincodes to add, unserved. */
  directory: {
    title: "Add pincodes by district",
    state: "State",
    chooseState: "Choose a state",
    districts: "Districts",
    districtsHint: "Up to ten.",
    /** "Pune · 98 pincodes, 12 held" */
    district: (name: string, pincodes: number, held: number) =>
      held === 0
        ? `${name} · ${String(pincodes)} pincodes`
        : `${name} · ${String(pincodes)} pincodes, ${String(held)} held`,
    show: "Show pincodes",
    showing: "Loading…",
    pincodes: "Pincodes",
    columns: ["Pincode", "Area", "District", "Post offices", "Held"],
    /** A pincode the service area holds already: its city. */
    held: (city: string) => `In ${city}`,
    notHeld: "—",
    all: "Tick every pincode not held",
    tick: (pincode: string, area: string) => `Add ${pincode}, ${area}`,
    city: "Add them to",
    add: (count: number) => (count === 1 ? "Add 1 pincode" : `Add ${String(count)} pincodes`),
    adding: "Adding…",
    added: (count: number, city: string, held: number) =>
      `${String(count)} added to ${city}, not served yet.${held === 0 ? "" : ` ${String(held)} already held.`}`,
    tooMany: "Choose ten districts or fewer.",
    errors: {
      invalid_request: "Check the city.",
      not_permitted: NOT_PERMITTED,
      offline: OFFLINE,
      unconfirmed: UNCONFIRMED,
      unknown: FAILED,
    },
  },
  /** Launches scheduled for a later day, served by the cron on the day (docs/decisions/0221-launches-scheduled-paused-and-checked.md). */
  launches: {
    title: "Launches",
    none: "No launches yet.",
    /** "Pune · 5 Nov · 12 pincodes" */
    line: (city: string, day: string, count: number) =>
      `${city} · ${day} · ${count === 1 ? "1 pincode" : `${String(count)} pincodes`}`,
    states: { scheduled: "Scheduled", live: "Live", cancelled: "Cancelled" },
    told: (alerted: number) => (alerted === 1 ? "1 told" : `${String(alerted)} told`),
    held: "Not live: no active technician in the city.",
    cancel: "Cancel",
    cancelLabel: (city: string, day: string) => `Cancel the ${city} launch on ${day}`,
    cancelCheck: (city: string, day: string) => `Cancel the ${city} launch on ${day}?`,
    keep: "Keep it",
    cancelled: "Launch cancelled.",
    schedule: "Schedule",
    scheduleTitle: (count: number, city: string) =>
      count === 1 ? `Schedule 1 pincode in ${city}` : `Schedule ${String(count)} pincodes in ${city}`,
    day: "Goes live on",
    scheduling: "Scheduling…",
    scheduled: (count: number, day: string) =>
      count === 1 ? `1 pincode goes live on ${day}.` : `${String(count)} pincodes go live on ${day}.`,
    back: "Back",
    errors: {
      invalid_request: "Pick a day after today, for unserved pincodes in this city.",
      already_served: "Some of these are served already.",
      already_scheduled: "Some of these are in another launch.",
      not_found: "That launch has gone live or been cancelled.",
      not_permitted: NOT_PERMITTED,
      offline: OFFLINE,
      unconfirmed: UNCONFIRMED,
      unknown: FAILED,
    },
  },
  /** What a city needs before its pincodes are served: each check, as it stands, and where it is put right. */
  readiness: {
    title: "Before it goes live",
    loading: "Checking…",
    checks: {
      technicians: (ready: boolean, count: number) =>
        ready ? `${String(count)} active ${count === 1 ? "technician" : "technicians"}` : "No active technician",
      fitters: (ready: boolean, count: number) =>
        ready ? `${String(count)} trained to fit` : "No technician trained to fit",
      hours: (ready: boolean, count: number) =>
        ready ? "Working hours set" : `${String(count)} without working hours`,
      homes: (ready: boolean, count: number) => (ready ? "Home pins set" : `${String(count)} without a home pin`),
      stockroom: (ready: boolean) => (ready ? "Stockroom set up" : "No stockroom"),
      gst: (ready: boolean) => (ready ? "GST registered for the state" : "No GST registration for the state"),
      centres: (ready: boolean, count: number) =>
        ready ? "Every pincode on the map" : `${String(count)} not on the map yet: placed within the hour`,
    },
    fix: "Fix",
    /** Only the first stops a launch; the rest are for ops to weigh. */
    blocks: "Nothing can be booked without an active technician.",
  },
  /** A city's map and its technicians' reach from home (docs/decisions/0223-reach-from-home.md). */
  reach: {
    title: "Reach",
    mapAlt: (city: string) => `${city}: its pincodes, and each technician’s reach from home`,
    key: "Green served · Grey not served · Amber paused · Red served, out of every reach · Navy a technician’s home and reach",
    outOfReach: (count: number) =>
      count === 1
        ? "1 served pincode no technician reaches:"
        : `${String(count)} served pincodes no technician reaches:`,
    unreached: (pincode: string, area: string, nearest: string | null) =>
      nearest === null ? `${pincode} ${area}` : `${pincode} ${area} (nearest ${nearest})`,
    nearest: (name: string, minutes: number) => `${name}, ${String(minutes)} min`,
    allReached: "Every served pincode is in someone’s reach.",
    unmeasured: "Set your technicians’ homes to see their reach.",
    chooseUnreached: "Choose them",
    within: (name: string, minutes: number, count: number) =>
      `${name} · ${String(minutes)} min · ${count === 1 ? "1 pincode" : `${String(count)} pincodes`}`,
    chooseWithin: (name: string) => `Choose the pincodes within ${name}’s reach`,
    choose: "Choose",
  },
  /** Demand for pincodes not served yet, and how the last month's launches went (ADR 0224). */
  demand: {
    nextTitle: "Next to open",
    nextNone: "Nobody is waiting or looking anywhere we don’t serve.",
    /** "Gurgaon · Sector 99", or India Post's "Mumbai, Maharashtra", or nothing known. */
    place: (city: string | null, area: string | null, district: string | null, state: string | null) =>
      [city, area].filter((each) => each !== null).join(" · ") ||
      [district, state].filter((each) => each !== null).join(", "),
    figures: (waiting: number, looked: number) => `${String(waiting)} waiting · ${String(looked)} looked in 90 days`,
    recentTitle: "Last 30 days",
    recentNone: "Nothing launched in the last 30 days.",
    recent: (pincode: string, area: string, city: string, day: string) => `${pincode} ${area} · ${city} · ${day}`,
    recentFigures: (told: number, booked: number) => `${String(told)} told · ${String(booked)} booked`,
  },
  /** A served pincode taking no new clients for a while; clients we already come to book as before. */
  pause: {
    pause: "Pause",
    resume: "Resume",
    title: (count: number) => (count === 1 ? "Pause 1 pincode" : `Pause ${String(count)} pincodes`),
    until: "New clients again from",
    hint: "No new consultations till then. Booked visits and existing clients carry on.",
    pausing: "Pausing…",
    paused: (count: number, day: string) =>
      count === 1 ? `1 pincode paused till ${day}.` : `${String(count)} pincodes paused till ${day}.`,
    resumed: (count: number) => (count === 1 ? "1 pincode resumed." : `${String(count)} pincodes resumed.`),
    /** The table's served cell for a pincode paused. */
    chip: (day: string) => `Paused till ${day}`,
    back: "Back",
    errors: {
      invalid_request: "Pick a day after today, for served pincodes only.",
      not_permitted: NOT_PERMITTED,
      offline: OFFLINE,
      unconfirmed: UNCONFIRMED,
      unknown: FAILED,
    },
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
    adding: "Adding…",
    added: (pincode: string, city: string) => `${pincode} added to ${city}.`,
    badPincode: "Six digits, starting 1–8.",
    badName: "2–40 characters, starting with a letter or digit.",
    errors: {
      pincode_held: "Already added.",
      invalid_request: "Check the pincode, area name and city.",
      not_permitted: NOT_PERMITTED,
      offline: OFFLINE,
      unconfirmed: UNCONFIRMED,
      unknown: FAILED,
    },
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
    edit: "Edit",
    editLabel: (pincode: string) => `Edit ${pincode}`,
    editTitle: (pincode: string, area: string) => (area === "" ? pincode : `${pincode} · ${area}`),
    cancel: "Cancel",
    /** The name a row's box holds: a letter or a digit first, as the API takes it. */
    badName: (pincode: string) => `${pincode}: 2–40 characters, starting with a letter or digit.`,
    save: "Save",
    saving: "Saving…",
    saved: (changed: number, alerted: number) => {
      const pincodes = changed === 1 ? "One pincode changed." : `${String(changed)} pincodes changed.`;
      if (alerted === 0) return pincodes;
      return `${pincodes} ${String(alerted)} WhatsApp ${alerted === 1 ? "message" : "messages"} sending.`;
    },
    /** A row that would serve a pincode from a day still to come, which /book would take bookings for at once. */
    later: (pincode: string) => `${pincode}: the launch date must be today or earlier.`,
    /** Pincodes chosen in the table, served or stopped together once ops say yes. */
    chosen: {
      one: (pincode: string) => `Choose ${pincode}`,
      all: "Choose every pincode shown",
      count: (count: number) => (count === 1 ? "1 pincode chosen" : `${String(count)} pincodes chosen`),
      serve: "Serve",
      stop: "Stop serving",
      clear: "Clear",
      serveCheck: (count: number, city: string) =>
        count === 1 ? `Serve 1 pincode in ${city}?` : `Serve ${String(count)} pincodes in ${city}?`,
      stopCheck: (count: number, city: string) =>
        count === 1 ? `Stop serving 1 pincode in ${city}?` : `Stop serving ${String(count)} pincodes in ${city}?`,
      /** Beneath the stop question: what stopping leaves in place. */
      stopLeaves: (visits: number, clients: number) =>
        visits === 0
          ? " Nothing is booked there."
          : ` ${String(visits)} booked ${visits === 1 ? "visit" : "visits"} for ${String(clients)} ${clients === 1 ? "client" : "clients"} stay booked.`,
    },
    upload: {
      title: "Upload",
      label: "Edited CSV",
      hint: "The file from Download CSV, with your changes. A new pincode needs its city.",
      /** What the file would change, pincode by pincode, before any of it is taken. */
      read: (changed: number) => (changed === 1 ? "1 pincode changes:" : `${String(changed)} pincodes change:`),
      columns: ["Pincode", "Area", "Now", "In the file"],
      state: (served: boolean, launch: string | null) => {
        const serving = served ? "Served" : "Not served";
        return launch === null ? serving : `${serving}, launch ${launch}`;
      },
      none: "No changes in the file.",
      /** Pincodes the file names that we do not hold yet, added from India Post's list before anything else. */
      adds: (count: number) =>
        count === 1 ? "1 new pincode, added not served:" : `${String(count)} new pincodes, added not served:`,
      addColumns: ["Pincode", "Area", "City"],
      /** A row with no area name, or one the API would not take: the area takes India Post's name until ops give one. */
      suggested: "India Post’s name",
      add: (count: number) => (count === 1 ? "Add 1 pincode" : `Add ${String(count)} pincodes`),
      adding: "Adding…",
      added: (count: number, unlisted: readonly string[]) =>
        unlisted.length === 0
          ? `${String(count)} added.`
          : `${String(count)} added. Not in India Post’s list: ${unlisted.join(", ")}. Add those below.`,
      apply: "Save these changes",
      cancel: "Cancel",
      badDate: (pincode: string) => `${pincode}: write the date as 2026-10-01.`,
      badServed: (pincode: string) => `${pincode}: served must be yes or no.`,
      badHeader: "Not the file from Download CSV. Download it again and make your changes there.",
    },
    download: "Download CSV",
    downloadName: "service-area.csv",
    errors: {
      not_permitted: NOT_PERMITTED,
      no_service_area: "At least one pincode must stay served.",
      launch_in_future: "Launch dates must be today or earlier.",
      no_technician: "No technician works in that city yet. Add one in Technicians first.",
      /** A pincode we do not hold: one is added below, never by the file. */
      invalid_request: "Unknown pincode. Add it first.",
      offline: OFFLINE,
      unconfirmed: UNCONFIRMED,
      unknown: FAILED,
    },
  },
} as const;

/** The Waitlist: who waits in each pincode, the longest wait first. */
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
