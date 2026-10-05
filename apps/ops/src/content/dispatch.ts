// The dispatch board's words (boards A1, A2 and A3): the week, a move and its reason, a block's drawer.

import { NOT_PERMITTED } from "./common.ts";

export const dispatch = {
  title: "Dispatch",
  /** Beside the title, as the board heads the week: "19 to 25 Sep". */
  week: (from: string, to: string) => `${from} to ${to}`,
  /** A cell, a zone or a sector the board has nothing for. */
  unknown: "—",
  /** A job with neither a client nor a kind on it, which a title still has to name. */
  unnamed: "this visit",
  util: (percent: number) => `${String(percent)}%`,
  /**
   * The board letters 92 and 88 per cent in brass and leaves 67 and
   * below quiet, so the peak reads without a chart. It writes no line, and this
   * is where we have drawn it.
   */
  peak: 80,
  /** A block's second line, as the board writes it: "Sec 65 · service". */
  types: {
    consultation: "consult",
    first_fit: "first fit",
    service: "service",
    replacement: "replace",
  } as Readonly<Record<string, string>>,
  /** The same four, named in full, as the drawer and the tray head a job. */
  typeNames: {
    consultation: "Consultation",
    first_fit: "First fit",
    service: "Service visit",
    replacement: "Replacement",
  } as Readonly<Record<string, string>>,
  windows: { morning: "morning", afternoon: "afternoon", evening: "evening" } as Readonly<Record<string, string>>,
  /**
   * Each window's hours, which the drawer writes as the board does
   * ("12 to 4 pm"). They are src/config/scheduling.ts's WINDOW_TIMES, still the
   * owner's to rule (docs/open-points.md, item 53); test/node/ops-content.test.ts
   * holds the two together.
   */
  windowHours: {
    morning: "9 am to 12 pm",
    afternoon: "12 to 4 pm",
    evening: "4 to 8 pm",
  } as Readonly<Record<string, string>>,
  /**
   * The week and the city the board shows, and a way to find a row among many.
   * The board letters the city in the header ("Gurgaon") and draws no control;
   * the brief asks for "a city and week picker" (A1), so they sit in a row
   * above the grid (docs/fidelity-method.md).
   */
  tools: {
    label: "Week, city and search",
    previous: "Previous week",
    next: "Next week",
    thisWeek: "This week",
    city: "City",
    everyCity: "Every city",
    /** A technician's name or zone, or a visit's client, area or pincode. */
    find: "Find a technician, client or area",
    // The board draws no search, and so no search that finds nothing.
    nothingFound: (text: string) => `Nothing on this week's board matches “${text}”.`,
  },
  board: {
    /** A block, for whoever is reading with a screen reader or moving by keyboard. */
    block: (job: string, date: string, window: string) => `${job}, ${date}, ${window}`,
    /** A block for a visit already done, which stays where it was worked and cannot be moved. */
    doneBlock: (job: string, date: string, window: string) => `${job}, ${date}, ${window}, done`,
    /** How far the technician has got, from his phone. A visit he has begun stays where it is. */
    begun: { arrived: "Arrived", started: "Started", closed: "Closed" } as Readonly<Record<string, string>>,
    begunBlock: (job: string, date: string, window: string, begun: string) =>
      `${job}, ${date}, ${window}, ${begun.toLowerCase()}`,
    /** The board draws no board without technicians. */
    empty: "No technician is on this board.",
    /** A day ops recorded leave on: no job can be dropped there, and none is offered (ADR 0062). */
    away: "Away",
    awayLabel: (technician: string, date: string) => `${technician} is away on ${date}`,
    /** Leave recorded over jobs already booked moves none of them; ops do. */
    stranded: (jobs: number) => `Away · ${String(jobs)} ${jobs === 1 ? "job" : "jobs"} to move`,
    strandedLabel: (technician: string, date: string, jobs: number) =>
      `${technician} is away on ${date}, with ${String(jobs)} ${jobs === 1 ? "job" : "jobs"} still to move`,
    /** Beneath the board, saying where leave comes from. */
    leave: "Leave is recorded on the Technicians screen. A day marked Away takes no job.",
  },
  tray: {
    title: "Unassigned",
    /**
     * The window the client picked. The day is not recorded with it, so none is
     * written: "Asked · Sat, morning" would pair the offered day with the asked
     * window (ADR 0063).
     */
    asked: (window: string) => `Asked · ${window}`,
    offered: (when: string) => `Offered · ${when}`,
    /** No Request behind the visit recorded a window, so there is nothing to compare (ADR 0063). */
    notAsked: "Asked · not recorded",
    /** The brief's "referral source": who invited the client, where someone did. */
    referred: (name: string) => `Referred by ${name}`,
    // A job still on a technician who was switched off, which no board draws.
    was: (name: string) => `Was ${name}'s · switched off`,
    /** Beneath the tray: where the asked window comes from, and why some rows have none. */
    same: "“Asked” is the window the client picked when booking; “not recorded” means they picked none.",
    // The board draws four waiting and no empty tray.
    empty: "Nothing is waiting for a technician.",
  },
  /** Board A3: the drawer a block opens. */
  /** Our words, all of them: letting a technician check in past the geofence, which no board draws. */
  letIn: {
    title: (technician: string) => `Let ${technician} check in`,
    note: "He can check in wherever his phone puts him, for this visit only. The distance is still recorded, with your reason.",
    reason: "Why",
    reasonHint:
      "Kept with the visit, and shown with a no-show's evidence: say what you know, such as the pin being at the society gate.",
    confirm: "Let him check in",
    sending: "Letting him in",
    close: "Close",
    done: (technician: string) => `${technician} can check in now: ask him to tap I have arrived again.`,
    errors: {
      invalid_request: "Say why.",
      not_changeable: "He has checked in already, or the visit is closed or cancelled. Reload the board.",
      not_found: "That visit is not on the board any more. Reload it.",
      not_permitted: NOT_PERMITTED,
      offline: "You are offline. Connect, then try again.",
      unknown: "That did not go through. Please try again.",
    } as Readonly<Record<string, string>>,
  },
  drawer: {
    /** The way past the geofence, for a visit today he has not checked in to. */
    letIn: "Let him check in",
    /** Beneath the name: "Fri 19 Sep · 12 to 4 pm · Imran Qureshi". */
    when: (date: string, hours: string, technician: string) => `${date} · ${hours} · ${technician}`,
    /** The badge at the drawer's head: never an amount (ADR 0025, item 33). */
    // at_visit: a consultation and fit in one visit, paid for once the client is fitted (ADR 0105).
    badges: { prepaid: "Prepaid", credit: "Credit", free: "Free", at_visit: "Pays once fitted" } as Readonly<
      Record<string, string>
    >,
    // The board draws no Service row; it names a first fit's hair system, say.
    rows: {
      type: "Type",
      service: "Service",
      area: "Area",
      state: "State",
      referred: "Referred by",
      // The board draws no note; the technician reads it on the client's card.
      note: "Client's note",
    },
    /** "Service visit · 1 slot", as the board writes it; a first fit takes 2. */
    type: (name: string, slots: number) => `${name} · ${String(slots)} ${slots === 1 ? "slot" : "slots"}`,
    /** "Sector 65 · 122018": the area the visit's pincode is in, and the pincode. */
    area: (area: string, pincode: string | null) => (pincode === null ? area : `${area} · ${pincode}`),
    // The board draws a scheduled visit only, and names no state.
    states: {
      scheduled: "Scheduled",
      dispatched: "Sent to the technician",
      in_progress: "In progress",
      completed: "Done",
      cancelled: "Cancelled",
      terminated: "Not done",
      other: "Other",
    } as Readonly<Record<string, string>>,
    /** The State row once the technician's phone says he has begun. */
    begun: {
      arrived: "Technician arrived",
      started: "Technician started",
      closed: "Closed by the technician",
    } as Readonly<Record<string, string>>,
    /** A visit the technician has started or closed has no move. */
    stays: "In progress, so it stays where it is.",
    /** The warning before ops move a visit the technician has checked in at. */
    checkedIn: (technician: string) =>
      `${technician} has checked in. Moving it clears the check-in, so they check in again at the new time.`,
    moveAnyway: "Move anyway",
    /** Board A3's two buttons: "WhatsApp Rohit" and "Open client". */
    whatsapp: (firstName: string) => `WhatsApp ${firstName}`,
    openClient: "Open client",
    /** A move the client has not heard of, and why, which ops tell him of by phone (ADR 0069). */
    untold: {
      no_consent: (when: string, mobile: string) =>
        `Not told of the move to ${when}: they have not agreed to WhatsApp. Call ${mobile}, then record it here.`,
      not_sent: (when: string, mobile: string) =>
        `Not told of the move to ${when}: the WhatsApp did not go. Call ${mobile}, then record it here.`,
    },
    /** The keyboard way to do what the drag does; the board draws the drag alone. */
    move: "Move this visit",
    /** The same for a job in the tray, whose drawer the board does not draw. */
    assign: "Assign to a technician",
    /** A visit ops cancel for the client, or close by hand once its technician's phone was lost. */
    cancel: "Cancel this visit",
    closeByHand: "Close by hand",
    close: "Close",
  },
  /** Board A2: the reason a move must carry, asked for before anything is written. */
  move: {
    /** "Move Rohit M. to Sandeep Yadav". */
    title: (job: string, technician: string) => `Move ${job} to ${technician}`,
    /** "Fri 19 Sep, afternoon → Sat 20 Sep, morning". */
    fromTo: (from: string, to: string) => `${from} → ${to}`,
    /** The tray's jobs have no technician yet, so there is nothing to move them from. */
    to: (to: string) => `To ${to}`,
    legend: "Why it is moving",
    /**
     * The design's five, in its order (src/policy/dispatch.ts), less "Skill needed · first fit certified": no
     * technician's skills are recorded, so nothing would stand behind it.
     */
    reasons: [
      { reason: "technician_unavailable", label: "Technician unavailable" },
      { reason: "client_asked", label: "Client asked to move it" },
      { reason: "zone_rebalance", label: "Zone rebalance" },
      { reason: "running_over", label: "Running over on an earlier job" },
    ],
    /** The board's line, for a client who agreed to WhatsApp about his visits. */
    note: (job: string) => `${job} is messaged on WhatsApp with the new window.`,
    /** One who has not; the move goes to the Tasks board until ops say they called (ADR 0069). */
    call: (name: string, mobile: string) => `${name} has not agreed to WhatsApp — call ${mobile} with the new window.`,
    /** After the line, where the visit was paid for: prepaid, or with the client's credit. */
    carries: "Their payment carries over.",
    /** A change of technician alone leaves the client's window as it was. */
    sameTime: (job: string) => `Only the technician changes. ${job} keeps the same window, so nobody is messaged.`,
    /** A visit with no client on our records. */
    noClient: "This visit has no client on our records to tell.",
    /**
     * The board's extra line inside the notice the visit was sold under, which the board writes as 24 hours. The
     * client keeps the free change they had: their own change counts from the time before we moved it (ADR 0096).
     */
    soon: (hours: number) =>
      `This visit is inside ${String(hours)} hours. The client is not charged, because we moved it.`,
    /** A move of a visit the technician had checked in at, chosen after the drawer's warning. */
    checkInCleared: "The technician's check-in is cleared. They check in again at the new time.",
    /** A move onto a day ops blacked out goes only with a reason, kept with the move. */
    blackout: (date: string) => `${date} is blacked out, so nothing is booked that day. Say why this visit goes ahead.`,
    blackoutReason: "Why it goes ahead that day",
    send: "Move and notify",
    /** The same button where nothing goes to the client, so it does not promise a message. */
    sendQuietly: "Move",
    sending: "Moving",
    cancel: "Cancel",
  },
  /** Choosing where a job lands, which the design does by dragging. */
  landing: {
    /** The bar above the board while a job is in hand, with the slot-size hint the brief asks for (A2). */
    moving: (job: string, size: string) => `Moving ${job}, ${size}. Choose a technician and a window.`,
    /** "a first fit, 2 slots". */
    size: (type: string, slots: number) => `${type}, ${String(slots)} ${slots === 1 ? "slot" : "slots"}`,
    /** While the board asks where the job would fit. */
    checking: "Finding where it fits.",
    /** A day with no window the job would land in; the board offers nothing to drop on. */
    noRoom: "No room",
    /** Each window of each technician's day with room, while a job is in hand. */
    choose: (job: string, technician: string, date: string, window: string) =>
      `Move ${job} to ${technician}, ${date}, ${window}`,
    /** The brief's "keyboard alternative: choose a destination from a list" (A2). */
    list: "Or choose where from a list",
    listPrompt: "A technician, day and window",
    listOption: (technician: string, date: string, window: string) => `${technician} · ${date} · ${window}`,
    listGo: "Choose",
    // A week with nowhere the job fits.
    nowhere: "Nowhere on this week's board has room for it.",
    stop: "Stop moving it",
    /** What happened, from the move's own answer: a message is claimed only where one was queued. */
    moved: {
      messaged: (job: string) =>
        `Moved. We're sending ${job} the new window on WhatsApp; if it fails, a call task appears.`,
      call: (job: string, name: string, mobile: string) =>
        `${job} moved. ${name} has not agreed to WhatsApp: call ${mobile} with the new window.`,
      unchanged: (job: string, technician: string) =>
        `${job} is now with ${technician}. The window is the same, so nobody was messaged.`,
      noClient: (job: string) => `${job} moved. The visit has no client on our records to tell.`,
    },
    /** The button that closes the call's task, beside the line that asks for the call. */
    told: "Told by phone",
    toldDone: (name: string) => `Recorded that ${name} was told by phone.`,
    /** A visit ops cancelled, or closed by hand, from its drawer. */
    cancelled: (job: string) => `${job}'s visit is cancelled.`,
    closedByHand: (job: string) => `${job}'s visit is closed.`,
    // The board draws no way past the geofence.
    letIn: (technician: string, job: string) => `${technician} can check in to ${job}'s visit now.`,
    /**
     * A refusal names the technician and the window it asked for: the clash check
     * runs before anything is written (ADR 0034), and the API answers with the
     * code alone.
     */
    clash: (technician: string, date: string, window: string) =>
      `${technician} already holds a job on ${date}, ${window}. Nothing was moved.`,
    /** Leave is named as leave, so ops know the day is off rather than merely full (ADR 0062). */
    onLeave: (technician: string, date: string) => `${technician} is away on ${date}. Nothing was moved.`,
    /** A move lands only at a start still ahead. */
    pastDay: (date: string) => `${date} has passed. Choose a day ahead. Nothing was moved.`,
    windowPassed: (date: string, window: string) =>
      `Too late for ${date}, ${window}. Choose a later window. Nothing was moved.`,
    /** The day was blacked out after the board offered it; picking it again asks for the reason. */
    blackout: (date: string) => `${date} is blacked out. Choose it again to give a reason. Nothing was moved.`,
    /** The window is free, but the visit's block has no room in it (ADR 0069). */
    doesNotFit: (type: string, technician: string, date: string, window: string) =>
      `${type} has no room in ${technician}'s ${window} on ${date}: its time is taken, or it would run past the day's end. Nothing was moved.`,
    /** Another ops user moved the job while this one was choosing (ADR 0069). */
    superseded: (job: string, where: string) =>
      `Someone else moved ${job} while you were choosing. It is now ${where}. Nothing was moved.`,
    supersededWhere: (technician: string, date: string, window: string) => `with ${technician}, ${date}, ${window}`,
    /** The job has left this week, or the city asked for, since. */
    supersededGone: "off this board",
    /** Another ops user's move of the same job is still being written. */
    beingMoved: (job: string) => `Someone else is moving ${job} right now. Nothing was moved.`,
    errors: {
      not_permitted: NOT_PERMITTED,
      invalid_request: "That move is not one we can make. Nothing was moved.",
      not_found: "This visit is no longer live. The board now shows it as it stands.",
      /** The technician began the visit after the board was read. */
      in_progress: "The technician has begun this visit, so it stays where it is. Nothing was moved.",
      offline: "You are offline. Connect, then try again.",
      unknown: "That did not go through. Nothing was moved.",
    },
    /** The call's record did not go through. */
    toldFailed: "That was not recorded. Try again.",
    /** A link asked for a visit this board does not hold. */
    notOnBoard: "That visit is no longer on this board. It may have moved to another week, or been cancelled.",
  },
} as const;
