// The dispatch board's words: the week, a move and its reason, a block's drawer.

import { distance } from "@maneman/web-kit/figures";
import { changed, FAILED, hoursAndMinutes, NOT_PERMITTED, OFFLINE, UNCONFIRMED } from "./common.ts";

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
  /** What the brass says, for a screen reader. */
  peakDay: "peak day",
  /** A block's second line, as the board writes it: "Sec 65 · service". */
  types: {
    consultation: "consult",
    first_fit: "first fit",
    service: "service",
    replacement: "replace",
  },
  /** The same four, named in full, as the drawer and the tray head a job. */
  typeNames: {
    consultation: "Consultation",
    first_fit: "First fit",
    service: "Service visit",
    replacement: "Replacement",
  },
  windows: { morning: "morning", afternoon: "afternoon", evening: "evening" },
  /**
   * The week and the city the board shows, and a way to find a row among many.
   * The board letters the city in the header ("Gurgaon") and draws no control;
   * the brief asks for "a city and week picker", so they sit in a row
   * above the grid (docs/fidelity-method.md).
   */
  tools: {
    label: "Week, city and search",
    previous: "Previous week",
    next: "Next week",
    thisWeek: "This week",
    city: "City",
    /** A technician's name or zone, or a visit's client, area or pincode. */
    find: "Find a technician, client or area",
    // The board draws no search, and so no search that finds nothing.
    nothingFound: (text: string) => `Nothing this week matches “${text}”.`,
  },
  board: {
    /** A block, for whoever is reading with a screen reader or moving by keyboard. */
    block: (job: string, date: string, time: string) => `${job}, ${date}, ${time}`,
    /** What a block's outline says while the search finds it. */
    found: (block: string) => `${block}, matches the search`,
    /** A block for a visit already done, which stays where it was worked and cannot be moved. */
    doneBlock: (job: string, date: string, time: string) => `${job}, ${date}, ${time}, done`,
    /** How far the technician has got, from their phone. A visit they have begun stays where it is. */
    begun: { arrived: "Arrived", started: "Started", closed: "Closed" },
    begunBlock: (job: string, date: string, time: string, begun: string) =>
      `${job}, ${date}, ${time}, ${begun.toLowerCase()}`,
    /** The board draws no board without technicians. */
    empty: "No technicians on this board.",
    /** A day ops recorded leave on: no job can be dropped there, and none is offered (ADR 0062). */
    away: "Away",
    awayLabel: (technician: string, date: string) => `${technician} is away on ${date}`,
    /** Leave over part of a day: "Away 2–5 pm". */
    awayFor: (hours: string) => `Away ${hours}`,
    awayForLabel: (technician: string, date: string, hours: string) => `${technician} is away ${hours} on ${date}`,
    /** Leave recorded over jobs already booked moves none of them; ops do. */
    stranded: (visits: number) => `Away · ${String(visits)} ${visits === 1 ? "visit" : "visits"} to move`,
    strandedLabel: (technician: string, date: string, visits: number) =>
      `${technician} is away on ${date}, with ${String(visits)} ${visits === 1 ? "visit" : "visits"} still to move`,
  },
  tray: {
    title: "Unassigned",
    /**
     * The window the client picked. The day is not recorded with it, so none is
     * written: "Asked · Sat, morning" would pair the offered day with the asked
     * window (ADR 0063).
     */
    asked: (window: string) => `Asked for the ${window}`,
    offered: (when: string) => `Offered ${when}`,
    /** No Request behind the visit recorded a window, so there is nothing to compare. */
    notAsked: "No time asked for",
    /** The brief's "referral source": who invited the client, where someone did. */
    referred: (name: string) => `Referred by ${name}`,
    // A job still on a technician who was switched off, which no board draws.
    was: (name: string) => `Was ${name}’s, now switched off`,
    // The board draws four waiting and no empty tray.
    empty: "Nothing unassigned.",
  },
  /** Our words, all of them: letting a technician check in past the geofence, which no board draws. */
  letIn: {
    title: (technician: string) => `Allow ${technician} to check in`,
    reason: "Reason",
    confirm: "Allow check-in",
    sending: "Allowing…",
    done: (technician: string) => `${technician} can check in now. Ask them to tap I have arrived again.`,
    errors: {
      invalid_request: "Give a reason.",
      not_changeable: changed("Already checked in, or the visit is closed or cancelled."),
      not_found: changed("No longer on the board."),
      not_permitted: NOT_PERMITTED,
      offline: OFFLINE,
      unconfirmed: UNCONFIRMED,
      unknown: FAILED,
    },
  },
  /** The drawer a block opens. */
  drawer: {
    /** What happened on the visit, a step a line, under its facts. */
    story: {
      title: "What happened",
      none: "Nothing yet. The technician hasn’t arrived.",
      failed: "Couldn’t load what happened.",
      steps: {
        check_in: "Arrived",
        start: "Started",
        before_photos: "Before photos taken",
        piece: "Hair system recorded",
        checklist: "Checklist ticked",
        consumables: "What was used recorded",
        after_photos: "After photos taken",
        outcome: "Closed",
      } as Readonly<Record<string, string | undefined>>,
      outcomes: { done: "done", partial: "partly done", no_show: "as a no-show" } as Readonly<
        Record<string, string | undefined>
      >,
      /** "Closed, done", "Arrived": a step, and on the last how the visit ended. */
      step: (step: string, outcome: string | undefined) => (outcome === undefined ? step : `${step}, ${outcome}`),
      photos: "See the photographs",
    },
    /** The way past the geofence, for a visit today they have not checked in to. */
    letIn: "Allow check-in",
    /** A move to another day the client is asked to confirm: the visit is still here until they do. */
    proposal: (name: string, when: string) => `Waiting for ${name} to confirm ${when}.`,
    withdraw: "Withdraw",
    /** Beneath the name: "Fri 19 Sep · 12 to 4 pm · Imran Qureshi". */
    when: (date: string, time: string, technician: string) => `${date} · ${time} · ${technician}`,
    // at_visit: a consultation and fit in one visit, paid once fitted (ADR 0105), or a visit paid by UPI there.
    /** The badge at the drawer's head: never an amount (ADR 0025, item 33). */
    badges: { prepaid: "Prepaid", credit: "Free visit", free: "No charge", at_visit: "Pays at the visit" },
    // The board draws no Service row; it names a first fit's hair system, say.
    rows: {
      type: "Type",
      service: "Service",
      area: "Area",
      state: "Status",
      referred: "Referred by",
      // The board draws no note; the technician reads it on the client's card.
      note: "Client’s note",
    },
    /** "Service visit · 1 h 30 min": the time it holds on the board. */
    type: (name: string, minutes: number) => `${name} · ${hoursAndMinutes(minutes)}`,
    /** "Sector 65 · 122018": the area the visit's pincode is in, and the pincode. */
    area: (area: string, pincode: string | null) => (pincode === null ? area : `${area} · ${pincode}`),
    // The board draws a scheduled visit only, and names no state.
    states: {
      scheduled: "Scheduled",
      dispatched: "Sent to technician",
      in_progress: "In progress",
      completed: "Done",
      cancelled: "Cancelled",
      terminated: "Not done",
      other: "Other",
    },
    /** The State row once the technician's phone says they have begun. */
    begun: {
      arrived: "Technician arrived",
      started: "Technician started",
      closed: "Closed by technician",
    },
    /** A visit the technician has started or closed has no move. */
    stays: "In progress. Can’t be moved.",
    /** The warning before ops move a visit the technician has checked in at. */
    checkedIn: (technician: string) =>
      `${technician} has checked in. Moving clears it, and they check in again at the new time.`,
    moveAnyway: "Move anyway",
    /** The drawer's two buttons: "WhatsApp Rohit" and "Open client". */
    whatsapp: (firstName: string) => `WhatsApp ${firstName}`,
    openClient: "Open client",
    /** A move the client has not heard of, and why, which ops tell them of by phone (ADR 0069). */
    untold: {
      no_consent: (when: string, mobile: string) =>
        `Not told of the move to ${when}: not opted in to WhatsApp. Call ${mobile}, then record it.`,
      not_sent: (when: string, mobile: string) =>
        `Not told of the move to ${when}: WhatsApp failed. Call ${mobile}, then record it.`,
    },
    /** The keyboard way to do what the drag does; the board draws the drag alone. */
    move: "Move visit",
    /** The same for a job in the tray, whose drawer the board does not draw. */
    assign: "Assign to a technician",
    /** A visit ops cancel for the client, or close by hand once its technician's phone was lost. */
    cancel: "Cancel visit",
    closeByHand: "Close the visit",
  },
  /** The reason a move must carry, asked for before anything is written. */
  move: {
    /** "Move Rohit M. to Sandeep Yadav". */
    title: (job: string, technician: string) => `Move ${job} to ${technician}`,
    /** "Fri 19 Sep, afternoon → Sat 20 Sep, morning". */
    fromTo: (from: string, to: string) => `${from} → ${to}`,
    /** The tray's jobs have no technician yet, so there is nothing to move them from. */
    to: (to: string) => `To ${to}`,
    /** Another technician, at the time it stood. */
    stays: (at: string) => `Same time, ${at}`,
    start: "Start",
    legend: "Reason",
    /**
     * The design's five, in its order (src/policy/dispatch.ts), less "Skill needed · first fit certified": no
     * technician's skills are recorded, so nothing would stand behind it.
     */
    reasons: [
      { reason: "technician_unavailable", label: "Technician unavailable" },
      { reason: "client_asked", label: "Client asked" },
      { reason: "zone_rebalance", label: "Zone rebalance" },
      { reason: "running_over", label: "Earlier visit running over" },
    ],
    /** The board's line, for a client who agreed to WhatsApp about their visits. */
    note: (job: string) => `${job} gets the new time on WhatsApp.`,
    /** One who has not; the move goes to the Tasks board until ops say they called. */
    call: (name: string, mobile: string) => `${name} isn’t on WhatsApp updates. Call ${mobile} with the new time.`,
    /** After the line, where the visit was paid for: prepaid, or with the client's credit. */
    carries: "Their payment carries over.",
    /** A change of technician alone leaves the client's time as it was. */
    sameTime: (job: string) => `${job} keeps the same time. No message sent.`,
    /** A client erased: nobody is left to tell. */
    noClient: "No client to notify.",
    /**
     * The board's extra line inside the notice the visit was sold under, which the board writes as 24 hours. The
     * client keeps the free change they had: their own change counts from the time before we moved it (ADR 0096).
     */
    soon: (hours: number) =>
      `The visit is less than ${String(hours)} hours away, but the client pays nothing for the change, as we moved it.`,
    /** A move of a visit the technician had checked in at, chosen after the drawer's warning. */
    checkInCleared: "The check-in is cleared. They check in again at the new time.",
    /** A move onto a day ops blacked out goes only with a reason, kept with the move. */
    blackout: (date: string) => `${date} is a closed day. Give a reason.`,
    blackoutReason: "Reason",
    /**
     * A client's visit to another day, for a reason other than theirs: they are asked, and the visit stays put until
     * they accept (docs/decisions/0115-a-move-to-another-day-waits-for-the-client.md).
     */
    ask: (job: string) => `We’ll ask ${job} on WhatsApp. It moves when they accept.`,
    askCall: (name: string, mobile: string) =>
      `${name} isn’t on WhatsApp updates. Call ${mobile}, and move it once they agree.`,
    askSend: (job: string) => `Ask ${job} to confirm`,
    asking: "Asking…",
    send: "Move and notify",
    /** The same button where nothing goes to the client, so it does not promise a message. */
    sendQuietly: "Move",
    sending: "Moving…",
    cancel: "Cancel",
  },
  /** A day on the road, opened from a column's head (ADR 0120). */
  routes: {
    open: "Routes",
    /** The button's whole name, since each column has one. */
    openLabel: (day: string) => `Routes for ${day}`,
    title: (day: string) => `Routes · ${day}`,
    mapAlt: (day: string) => `Map of each technician’s route on ${day}`,
    loading: "Loading…",
    failed: "Couldn’t load the routes.",
    none: "No visits this day.",
    driveTimes: { off: "Drive times are off.", unavailable: "Some drive times are unavailable." },
    noPin: "no pin",
    drive: (minutes: number, km: number) => `${String(minutes)} min · ${distance(km * 1000)}`,
    /** A drive longer than the gap between two visits. */
    tight: (minutes: number, gap: number) => `${String(minutes)} min drive, ${String(Math.max(gap, 0))} min gap`,
  },
  /** Choosing where a job lands: a technician's day from the list, then a start. */
  landing: {
    /** The bar above the board while a job is in hand, with the slot-size hint the brief asks for. */
    moving: (job: string, size: string) => `Moving ${job}, ${size}.`,
    /** "a first fit, 3 h". */
    size: (type: string, minutes: number) => `${type}, ${hoursAndMinutes(minutes)}`,
    /** While the board asks where the job would fit. */
    checking: "Finding space…",
    /** Where it can go: a technician's day with room. */
    list: "Move to",
    listPrompt: "A technician and day",
    /** A day's first free start: "from 9:30 am". */
    from: (time: string) => `from ${time}`,
    /** With how far the job is from that technician's nearest other visit that day, where known. */
    listOption: (technician: string, date: string, from: string, km: number | null) =>
      [technician, date, from, km === null ? null : distance(km * 1000)].filter(Boolean).join(" · "),
    listGo: "Choose",
    // A week with nowhere the job fits.
    nowhere: "No room this week.",
    stop: "Stop moving",
    /** What happened, from the move's own answer: a message is claimed only where one was queued. */
    moved: {
      messaged: (job: string) => `Moved. ${job} gets the new time on WhatsApp.`,
      call: (name: string, mobile: string) =>
        `Moved. ${name} isn’t on WhatsApp updates: call ${mobile} with the new time.`,
      unchanged: (job: string, technician: string) => `${job} is now with ${technician}. Same time.`,
      noClient: (job: string) => `${job} moved. No client to notify.`,
    },
    /** A client asked to confirm a move to another day: on WhatsApp, or by ops' call. */
    asked: {
      messaged: (job: string, when: string) => `Asked ${job} on WhatsApp to confirm ${when}.`,
      call: (name: string, mobile: string, when: string) => `Call ${name} on ${mobile} to ask about ${when}.`,
    },
    withdrawn: (job: string) => `Withdrawn. ${job} stays as booked.`,
    /** Why a move could not be taken back; the board is read again either way. */
    withdrawErrors: {
      not_permitted: NOT_PERMITTED,
      not_found: "Already answered or taken back.",
      offline: OFFLINE,
      unconfirmed: UNCONFIRMED,
      unknown: "Couldn’t withdraw. Try again.",
    },
    /** The button that closes the call's task, beside the line that asks for the call. */
    told: "Told by phone",
    toldDone: (name: string) => `Recorded: ${name} told by phone.`,
    /** A visit ops cancelled, or closed by hand, from its drawer. */
    cancelled: (job: string) => `${job}’s visit cancelled.`,
    closedByHand: (job: string) => `${job}’s visit closed.`,
    // The board draws no way past the geofence.
    letIn: (technician: string, job: string) => `${technician} can check in to ${job}’s visit now.`,
    /**
     * A refusal names the technician and the time it asked for: the check runs
     * before anything is written (ADR 0034), and the API answers with the code alone.
     */
    clash: (technician: string, date: string, time: string) => `${technician} already has a job on ${date}, ${time}.`,
    /** Leave is named as leave, so ops know the day is off rather than merely full. */
    onLeave: (technician: string, date: string) => `${technician} is away on ${date}.`,
    /** A technician never takes two of a client's visits in a row (ADR 0111). */
    backToBack: (technician: string) =>
      `${technician} has this client’s visit just before or after. Choose someone else.`,
    /** A move lands only at a start still ahead. */
    pastDay: (date: string) => `${date} has passed. Choose a later day.`,
    windowPassed: (date: string, time: string) => `Too late for ${date}, ${time}. Choose a later time.`,
    /** The day was blacked out after the board offered it; picking it again asks for the reason. */
    blackout: (date: string) => `${date} is a closed day. Choose it again to give a reason.`,
    /** Nothing holds the time, but the technician's day has no room for the visit there, with its drives. */
    doesNotFit: (type: string, technician: string, date: string, time: string) =>
      `${type}: no room in ${technician}’s day at ${time} on ${date}.`,
    /** Another ops user moved the job while this one was choosing. */
    superseded: (job: string, where: string) => `${job} was just moved by someone else. It’s now ${where}.`,
    supersededWhere: (technician: string, date: string, time: string) => `with ${technician}, ${date}, ${time}`,
    /** The job has left this week, or the city asked for, since. */
    supersededGone: "off this board",
    /** Another ops user's move of the same job is still being written. */
    beingMoved: (job: string) => `Someone else is moving ${job} right now.`,
    /** A visit goes only to a technician in its own city; one with no city yet takes none (ADR 0117). */
    otherCity: (technician: string) => `${technician} doesn’t work in this visit’s city.`,
    /** A first fit or a replacement goes only to a technician trained to fit (ADR 0119). */
    notTrained: (technician: string) => `${technician} isn’t trained to fit.`,
    errors: {
      not_permitted: NOT_PERMITTED,
      invalid_request: "That move isn’t possible. Choose another technician or time.",
      not_found: "This visit no longer exists.",
      /** The technician began the visit after the board was read. */
      in_progress: "The technician has started this visit. It can’t be moved.",
      ask_the_client: "Another day needs the client’s OK. If you have it, choose Client asked.",
      offline: OFFLINE,
      unconfirmed: UNCONFIRMED,
      unknown: FAILED,
    },
    /** Why the call's record did not go through. */
    toldErrors: {
      not_permitted: NOT_PERMITTED,
      not_found: "Already marked as told.",
      offline: OFFLINE,
      unconfirmed: UNCONFIRMED,
      unknown: FAILED,
    },
    /** A link asked for a visit this board does not hold. */
    notOnBoard: "That visit isn’t on this board.",
  },
} as const;
