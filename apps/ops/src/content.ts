// Every word the ops console shows, from design/phase2/Ops Console.dc.html. A
// component holds no copy of its own. Lines the design does not draw are
// marked PLACEHOLDER, pending the owner's wording.

/** The public site's booking page, which a launch alert sends people to, as apps/app/src/content.ts has it. */
export const BOOKING_URL: Readonly<Record<string, string>> = {
  local: "http://127.0.0.1:4321/book",
  staging: "https://staging.maneman.in/book",
  production: "https://maneman.in/book",
};

export const shell = {
  /** The sidebar's own title, as boards A1 and B1 letter it. */
  title: "Operations",
  /**
   * Each section's name in the navigation, in apps/ops/src/route.ts's order;
   * the design draws eight. Its third is drawn as "Payments" and built as
   * "No-shows": the day's money is there, over the queue, but the dispute the
   * board rules on has no record behind it (docs/open-points.md, item 57).
   * Settings is the eighth, built from ADR 0061.
   *
   * Grievances, Deletion requests and Number changes are drawn on no board at
   * all. They are what a client asks of us about their own data
   * (docs/decisions/0049-dpdp.md, docs/fidelity-method.md).
   */
  sections: {
    dispatch: "Dispatch",
    clients: "Clients",
    "no-shows": "No-shows",
    referrals: "Referrals",
    waitlist: "Waitlist",
    tasks: "Tasks",
    technicians: "Technicians",
    grievances: "Grievances",
    "deletion-requests": "Deletion requests",
    "number-changes": "Number changes",
    settings: "Settings",
  },
  /** The browser tab's title: "Prices · Settings · Mane Man operations". */
  documentTitle: (parts: readonly string[]) => [...parts, "Mane Man operations"].join(" · "),
  /**
   * PLACEHOLDER: who is signed in, where board A1 draws "AK" in a box at the
   * header's right, and a way out, which it does not draw. Signing out ends the
   * Cloudflare Access session, which is the only session the console has.
   */
  account: {
    signedInAs: (who: string) => `Signed in as ${who}`,
    signOut: "Sign out",
  },
  /**
   * PLACEHOLDER: Cloudflare Access ends a session after the time the team sets,
   * and from then on every call is sent to its login page instead of reaching
   * us. Reloading the page is what takes ops there.
   */
  lapsed: "Your sign-in to the console has run out, so nothing more can be read or saved. Reload to sign in again.",
  reload: "Reload",
} as const;

export const states = {
  loading: "Loading",
  failed: "We could not load this.",
  retry: "Try again",
} as const;

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
   * PLACEHOLDER: the board letters 92 and 88 per cent in brass and leaves 67 and
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
   * PLACEHOLDER: each window's hours, which the drawer writes as the board does
   * ("12 to 4 pm"). They are src/config/scheduling.ts's WINDOW_TIMES, still the
   * owner's to rule (docs/open-points.md, item 24); test/node/ops-content.test.ts
   * holds the two together.
   */
  windowHours: {
    morning: "9 am to 12",
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
    /** A technician's name or zone, or a client on one of their days. */
    find: "Find a technician, zone or client",
    // PLACEHOLDER: the board draws no search, and so no search that finds nothing.
    nothingFound: (text: string) => `No technician, zone or client this week matches “${text}”.`,
  },
  board: {
    /** A block, for whoever is reading with a screen reader or moving by keyboard. */
    block: (job: string, date: string, window: string) => `${job}, ${date}, ${window}`,
    /** A block for a visit already done, which stays where it was worked and cannot be moved. */
    doneBlock: (job: string, date: string, window: string) => `${job}, ${date}, ${window}, done`,
    /** PLACEHOLDER: the board draws no board without technicians. */
    empty: "No technician is on this board.",
    /** A day ops recorded leave on: no job can be dropped there, and none is offered (ADR 0062). */
    away: "Away",
    awayLabel: (technician: string, date: string) => `${technician} is away on ${date}`,
    /** PLACEHOLDER: leave recorded over jobs already booked moves none of them; ops do (OPS-07). */
    stranded: (jobs: number) => `Away · ${String(jobs)} ${jobs === 1 ? "job" : "jobs"} to move`,
    strandedLabel: (technician: string, date: string, jobs: number) =>
      `${technician} is away on ${date}, with ${String(jobs)} ${jobs === 1 ? "job" : "jobs"} still to move`,
    /** Beneath the board, saying where leave comes from, since it is ours and not FSM's. */
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
    /** Beneath the tray: where the asked window comes from, and why some rows have none. */
    same: "Asked is what the client picked on their booking. A visit booked without one says so.",
    // PLACEHOLDER: the board draws four waiting and no empty tray.
    empty: "Nothing is waiting for a technician.",
  },
  /** Board A3: the drawer a block opens. */
  drawer: {
    /** Beneath the name: "Fri 19 Sep · 12 to 4 pm · Imran Qureshi". */
    when: (date: string, hours: string, technician: string) => `${date} · ${hours} · ${technician}`,
    /** The badge at the drawer's head: never an amount (ADR 0025, item 33). */
    badges: { prepaid: "Prepaid", credit: "Credit", free: "Free" } as Readonly<Record<string, string>>,
    rows: { type: "Type", area: "Area", state: "State", referred: "Referred by" },
    /** "Service visit · 1 slot", as the board writes it; a first fit takes 2. */
    type: (name: string, slots: number) => `${name} · ${String(slots)} ${slots === 1 ? "slot" : "slots"}`,
    /** "Sector 65 · 122018": the area the visit's pincode is in, and the pincode. */
    area: (area: string, pincode: string | null) => (pincode === null ? area : `${area} · ${pincode}`),
    // PLACEHOLDER: the board draws a scheduled visit only, and names no state.
    states: {
      scheduled: "Scheduled",
      dispatched: "Sent to the technician",
      in_progress: "In progress",
      completed: "Done",
      cancelled: "Cancelled",
      terminated: "Terminated",
      other: "Other",
    } as Readonly<Record<string, string>>,
    /** Board A3's two buttons: "WhatsApp Rohit" and "Open client". */
    whatsapp: (firstName: string) => `WhatsApp ${firstName}`,
    openClient: "Open client",
    /** PLACEHOLDER: a move the client has not heard of, which ops tell him of by phone (ADR 0069). */
    untold: (when: string, mobile: string) =>
      `Not told of the move to ${when}: no WhatsApp. Call ${mobile}, then record it here.`,
    /** The keyboard way to do what the drag does; the board draws the drag alone. */
    move: "Move this visit",
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
    /** The five the design lists, in its order (src/policy/dispatch.ts). */
    reasons: [
      { reason: "technician_unavailable", label: "Technician unavailable" },
      { reason: "client_asked", label: "Client asked to move it" },
      { reason: "zone_rebalance", label: "Zone rebalance" },
      { reason: "skill_needed", label: "Skill needed · first fit certified" },
      { reason: "running_over", label: "Running over on an earlier job" },
    ],
    /** The board's line, for a client who agreed to WhatsApp about his visits. */
    note: (job: string) => `${job} is messaged on WhatsApp with the new window. Their payment carries over.`,
    /** PLACEHOLDER: one who has not; the move goes to the Tasks board until ops say they called (ADR 0069). */
    call: (name: string, mobile: string) =>
      `${name} has not agreed to WhatsApp — call ${mobile} with the new window. Their payment carries over.`,
    /** PLACEHOLDER: a change of technician alone leaves the client's window as it was. */
    sameTime: (job: string) => `Only the technician changes. ${job} keeps the same window, so nobody is messaged.`,
    /** PLACEHOLDER: a visit with no client on our records. */
    noClient: "This visit has no client on our records to tell. Their payment carries over.",
    /** The board's extra line within 24 hours of the visit. */
    soon: "This visit is inside 24 hours. The client is not charged, because we moved it.",
    send: "Move and notify",
    /** PLACEHOLDER: the same button where nothing goes to the client, so it does not promise a message. */
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
    /** PLACEHOLDER: while the board asks where the job would fit. */
    checking: "Finding where it fits.",
    /** PLACEHOLDER: a day with no window the job would land in; the board offers nothing to drop on. */
    noRoom: "No room",
    /** Each window of each technician's day with room, while a job is in hand. */
    choose: (job: string, technician: string, date: string, window: string) =>
      `Move ${job} to ${technician}, ${date}, ${window}`,
    /** The brief's "keyboard alternative: choose a destination from a list" (A2). */
    list: "Or choose where from a list",
    listPrompt: "A technician, day and window",
    listOption: (technician: string, date: string, window: string) => `${technician} · ${date} · ${window}`,
    listGo: "Choose",
    // PLACEHOLDER: a week with nowhere the job fits.
    nowhere: "Nowhere on this week's board has room for it.",
    stop: "Stop moving it",
    /** What happened, from the move's own answer: a message is claimed only where one was queued. */
    moved: {
      messaged: (job: string) => `${job} moved. The client was sent the new window on WhatsApp.`,
      call: (job: string, name: string, mobile: string) =>
        `${job} moved. ${name} has not agreed to WhatsApp: call ${mobile} with the new window.`,
      unchanged: (job: string, technician: string) =>
        `${job} is now with ${technician}. The window is the same, so nobody was messaged.`,
      noClient: (job: string) => `${job} moved. The visit has no client on our records to tell.`,
    },
    /** PLACEHOLDER: the button that closes the call's task, beside the line that asks for the call. */
    told: "Told by phone",
    toldDone: (name: string) => `Recorded that ${name} was told by phone.`,
    /**
     * A refusal names the technician and the window it asked for: the clash check
     * runs before anything is written (ADR 0034), and the API answers with the
     * code alone.
     */
    clash: (technician: string, date: string, window: string) =>
      `${technician} already holds a job on ${date}, ${window}. Nothing was moved.`,
    /** Leave is named as leave, so ops know the day is off rather than merely full (ADR 0062). */
    onLeave: (technician: string, date: string) => `${technician} is away on ${date}. Nothing was moved.`,
    /** PLACEHOLDER: the window is free, but the visit's block has no room in it (ADR 0069). */
    doesNotFit: (type: string, technician: string, date: string, window: string) =>
      `${type} has no room in ${technician}'s ${window} on ${date}: its time is taken, or it would run past the day's end. Nothing was moved.`,
    /** PLACEHOLDER: another ops user moved the job while this one was choosing (ADR 0069). */
    superseded: (job: string, where: string) =>
      `Someone else moved ${job} while you were choosing. It is now ${where}. Nothing was moved.`,
    supersededWhere: (technician: string, date: string, window: string) => `with ${technician}, ${date}, ${window}`,
    /** PLACEHOLDER: the job has left this week, or the city asked for, since. */
    supersededGone: "off this board",
    /** PLACEHOLDER: another ops user's move of the same job is still being written. */
    beingMoved: (job: string) => `Someone else is moving ${job} right now. Nothing was moved.`,
    errors: {
      invalid_request: "That move is not one we can make. Nothing was moved.",
      not_found: "This visit is no longer live. The board now shows it as it stands.",
      fsm_refused: "Our scheduling system would not take it. Nothing was moved.",
      /** PLACEHOLDER: FSM took the new technician and not the new time; the board is read again. */
      fsm_partly:
        "Our scheduling system took the new technician but not the new time. The board now shows it as it stands.",
      offline: "You are offline. Connect, then try again.",
      unknown: "That did not go through. Nothing was moved.",
    },
    /** PLACEHOLDER: the call's record did not go through. */
    toldFailed: "That was not recorded. Try again.",
  },
} as const;

export const referrals = {
  title: "Referrals",
  queue: {
    title: "Held for review",
    /** The design writes "Rohit Malhotra → Vikram Sethi"; each name is a way to that client's page. */
    arrow: "→",
    /** How long the grant has waited, as the design writes it: "3 days held", "1 day held", "5 hours held". */
    held: (count: number, unit: "hour" | "day") => `${String(count)} ${unit}${count === 1 ? "" : "s"} held`,
    /** The rule the grant met, in the order docs/prompts/phase2-backend.md states them. */
    signals: {
      shared_address: "Same address",
      shared_upi: "Same UPI handle",
      monthly_cap: "Monthly cap exceeded",
      // PLACEHOLDER: the board draws the other three rules, not this one.
      same_mobile: "Same mobile number",
    },
    approve: "Approve",
    reject: "Reject",
    /**
     * PLACEHOLDER: board C1 requires a reason for both decisions
     * (docs/prompts/phase2-frontend.md) and draws no field for either.
     */
    reason: {
      label: { approve: "Why you are approving it", reject: "Why you are rejecting it" },
      /** The reason stays with the decision; the audit log names the decision and who made it (ADR 0031). */
      hint: "Kept with the decision, under your name.",
      confirm: { approve: "Approve the grant", reject: "Reject the grant" },
      cancel: "Keep it held",
    },
    /** PLACEHOLDER: the board draws no empty queue. */
    empty: "Nothing is held for review.",
    deciding: "Deciding",
    errors: {
      not_found: "Someone has decided this one already. Reload to see the queue as it stands.",
      offline: "You are offline. Connect, then try again.",
      unknown: "That did not go through. Please try again.",
    } as Readonly<Record<string, string>>,
  },
  table: {
    title: "All referrers",
    /** The board's columns, less "Sent", which nothing counts (docs/fidelity-method.md). */
    columns: ["Referrer", "Opens", "Consults", "Fits", "Granted", "Redeemed"],
    note: "Opens and consultations stay here. The client's tracker shows fits only.",
    // PLACEHOLDER: the board draws no empty table.
    empty: "Nobody has a referral code yet.",
    /** PLACEHOLDER: the table is read fifty referrers at a time, the busiest first. */
    more: "Show more referrers",
    loading: "Loading",
  },
} as const;

export const clients = {
  title: "Clients",
  /** A cell with nothing in it, written as the design's tables write a gap. */
  unknown: "—",
  /**
   * PLACEHOLDER: the board opens on a client page and draws no way of reaching
   * one. What ops type is sent in the request body, never in a path or a query
   * string, so a number stays out of URLs, referrers and logs.
   */
  find: {
    label: "Name or number",
    hint: "Any part of the name, or four digits or more of the number.",
    submit: "Find",
    finding: "Looking",
    /** The matches, by name, each a way to the client's page. */
    found: "Clients",
    none: (text: string) => `Nobody matches “${text}”. An erased client has no page.`,
    more: "More clients match than are listed. Add to the name or the number.",
    errors: {
      invalid_request: "Type two letters of a name, or four digits of a number.",
      offline: "You are offline. Connect, then try again.",
      unknown: "That did not go through. Please try again.",
    } as Readonly<Record<string, string>>,
  },
  /**
   * The line beneath the name. The board draws five: tier, status, the usual
   * technician, credits and when a replacement is due. Nothing records a tier
   * or a usual technician (docs/fidelity-method.md); the replacement date is
   * the piece in wear's, as a month, exactly as the board writes it. The
   * mobile is ours: the board draws a WhatsApp button and no number to call.
   */
  meta: { state: "Status", credits: "Credits", replacement: "Replacement due", mobile: "Mobile" },
  /** Board B1's button beside the name, which opens a chat with the client. */
  whatsapp: "WhatsApp",
  whatsappLabel: (name: string) => `WhatsApp ${name}`,
  /** The number as a way to call, since a client who never agreed to WhatsApp is called. */
  callLabel: (name: string, mobile: string) => `Call ${name} on ${mobile}`,
  // PLACEHOLDER: the board writes "Active"; the API's three states are these.
  states: { fitted: "Fitted", lead: "Booked", nothing_booked: "Nothing booked" },
  /** The head's credits, as the board writes them: "2 · expire 3 Jan 2028". */
  creditLine: (visits: number, expiry: string | null) =>
    expiry === null ? String(visits) : `${String(visits)} · expire ${expiry}`,
  /**
   * PLACEHOLDER: the board draws no client without a piece. A client wearing
   * none falls due on no date at all, so the head says so rather than drawing
   * the gap a missing figure would draw.
   */
  noPiece: "No piece fitted",
  /** The tabs of the design's eight that the ops routes answer, in its order, and History, which it draws none of. */
  tabs: [
    { tab: "visits", label: "Visits" },
    { tab: "pieces", label: "Pieces" },
    { tab: "payments", label: "Payments" },
    { tab: "consents", label: "Consents" },
    { tab: "photos", label: "Photos" },
    { tab: "history", label: "History" },
  ],
  failed: "We could not load this client.",
  /*
   * PLACEHOLDER, all of it: the board draws a Visits tab and nothing in it. It
   * is the record's own address and visits, which the page already holds, so
   * the tab reads nothing more from the API.
   */
  visits: {
    address: "Visits go to",
    noAddress: "No address saved yet. The client adds it in their app, or the technician is told on the day.",
    access: "Access",
    upcoming: "To come",
    past: "Done",
    columns: ["Date", "Time", "Visit", "Technician", "State"],
    noUpcoming: "Nothing booked.",
    noPast: "No visit done yet.",
    /** "9 am to 12", as the dispatch drawer writes a window. */
    time: (from: string, to: string) => `${from} to ${to}`,
    types: {
      consultation: "Consultation",
      first_fit: "First fit",
      service: "Service visit",
      replacement: "Replacement",
    },
    /** A visit to come, by where it stands, and one done, by how FSM closed it. */
    stages: { booked: "Booked", in_progress: "Under way", closing: "Being closed" },
    // PLACEHOLDER: "Not home" is ours; the board draws Done and Partial.
    outcomes: { done: "Done", partial: "Partial", no_show: "Not home" },
    statuses: { cancelled: "Cancelled", terminated: "Not done", other: "—" } as Readonly<Record<string, string>>,
    /** Paid ahead, or covered by a credit: board C1 of the client app's own badge. */
    prepaid: "Prepaid",
  },
  /*
   * PLACEHOLDER, all of it: the board draws a Payments tab and nothing in it.
   * It is the record's own payments and refunds, and the credits a client can
   * be given or have taken away by hand (docs/decisions/0068-a-paid-hold-is-kept.md).
   */
  payments: {
    title: "Payments and refunds",
    columns: ["Date", "What", "Amount", "State"],
    none: "Nothing paid yet.",
    /** "Service visit of 22 Aug 2027", and a late fee named as one. */
    visit: (type: string, date: string) => `${type} of ${date}`,
    unlinked: "Payment",
    lateFee: "Late fee",
    refund: "Refund",
    paymentStates: {
      authorized: "Authorised",
      captured: "Paid",
      refunded: "Refunded",
      partially_refunded: "Part refunded",
    } as Readonly<Record<string, string>>,
    refundStates: { created: "Processing", processed: "Back", failed: "Failed" } as Readonly<Record<string, string>>,
    reference: (reference: string) => `Ref ${reference}`,
  },
  /** Putting a client's service-visit credits right by hand (POST /api/clients/{id}/credits). */
  credits: {
    title: "Service-visit credits",
    balance: "They hold",
    none: "None",
    visits: (count: number) => `${String(count)} ${Math.abs(count) === 1 ? "visit" : "visits"}`,
    expiry: (date: string) => `The soonest expires ${date}.`,
    change: "Visits to add, or to take away with a minus",
    changeHint: "A whole number from -12 to 12, never 0.",
    reason: "Why",
    reasons: [
      { reason: "correction", label: "Correction: given or taken in error" },
      { reason: "goodwill", label: "Goodwill: to make up for something" },
    ],
    note: "Kept in the credit ledger and the audit log, under your name. The client sees their new balance in their app.",
    save: "Put the credits right",
    saving: "Saving",
    saved: (count: number) => `Done. They now hold ${String(count)} ${count === 1 ? "visit" : "visits"}.`,
    errors: {
      invalid_request:
        "That would take away more visits than they hold, or is not a number from -12 to 12. Nothing was changed.",
      not_found: "This client is no longer on our records. Nothing was changed.",
      offline: "You are offline. Connect, then try again.",
      unknown: "That did not go through. Nothing was changed.",
    } as Readonly<Record<string, string>>,
  },
  /** Board B1: every piece the client has been fitted with, from FSM's assets. */
  pieces: {
    title: "Pieces",
    /** The board's six columns, in its order. */
    columns: ["Piece", "Base", "Fitted", "Supplier lot", "Replace due", "Failed · reason"],
    /** A piece that has failed, as the board writes it: "24 Jun · base split at crown". */
    failed: (date: string, reason: string | null) => (reason === null ? date : `${date} · ${reason}`),
    // PLACEHOLDER: the board draws no client without a piece, and every client has none until they are fitted.
    empty: "No piece has been fitted for this client.",
  },
  photos: {
    locked: "Locked",
    title: (name: string) => `Photographs of ${name}`,
    /** The board's words, with the client's first name where it writes "Rohit". */
    warning: (firstName: string) =>
      `Opening these records your name, the client and the time. The log is visible to the city head and to ${firstName} on request.`,
    open: "View photos",
    /** The state the board draws once they are open, with the time the API logged the opening, by its own clock. */
    opened: (time: string) => `Open · logged ${time}`,
    /**
     * PLACEHOLDER: the board writes who opened them last ("AK · 19 Sep"); this
     * is the log it promises the city head, each opening before this one.
     */
    before: "Opened before",
    beforeRow: (by: string, date: string, time: string) => `${by} · ${date}, ${time}`,
    neverBefore: "Nobody has opened them before.",
    /** PLACEHOLDER: the earlier visits' photographs, fetched only when asked for. */
    earlier: (visits: number) => `Show ${String(visits)} earlier ${visits === 1 ? "visit" : "visits"}`,
    angles: { front: "Front", top: "Top", left: "Left", right: "Right", hair: "Hair" },
    // PLACEHOLDER: the board draws one visit's five angles; a visit has a set before and a set after.
    phases: { before: "Before", after: "After" },
    /** The board's caption beneath a visit's photographs: "22 Aug 2027 · service visit · Imran". */
    caption: (date: string, type: string, technician: string) => `${date} · ${type} · ${technician}`,
    // PLACEHOLDER: the four visit types, as the board's caption writes one.
    types: {
      consultation: "consultation",
      first_fit: "first fit",
      service: "service visit",
      replacement: "replacement",
    },
    // PLACEHOLDER: a photograph's description for a screen reader; the board draws no captions.
    alt: (angle: string, phase: string, date: string) => `${angle}, ${phase.toLowerCase()} the visit of ${date}`,
    // PLACEHOLDER: the board draws no client without photographs, and no photograph that would not load.
    empty: "No photographs of this client yet, so nothing was logged.",
    errors: {
      unavailable: "The view could not be recorded, so nothing is shown.",
      offline: "You are offline. Connect, then try again.",
      unknown: "That photograph did not load.",
    } as Readonly<Record<string, string>>,
  },
  consents: {
    title: "Consents",
    /** The board's four columns, with "Notice" where it writes "Source" (docs/fidelity-method.md). */
    columns: ["Purpose", "State", "Date", "Notice"],
    purposes: {
      photos_own_record: "Photographs for the client record",
      photos_referral_cards: "Photographs on referral cards",
      photos_marketing: "Photographs in marketing",
      whatsapp_visits: "WhatsApp about visits",
      whatsapp_launches: "WhatsApp about launches",
    },
    states: { given: "Given", not_given: "Not given", withdrawn: "Withdrawn" },
    /** The board's note. It writes "from his own app"; this says "their" (docs/fidelity-method.md). */
    note: "Ops cannot grant a consent. Only the client can, from their own app.",
    /**
     * PLACEHOLDER: the board draws no deletion request, and the route answers
     * with the client's latest one, which belongs beside their consents.
     */
    deletion: {
      requested: (date: string) => `Erasure requested ${date}. It is not decided here.`,
      rejected: (date: string) => `Erasure requested ${date} and refused.`,
    },
  },
  /*
   * The client's record in figures (src/domain/client-history.ts). The design
   * draws no such tab, so every line below is a placeholder; the figures
   * themselves are the ones the board's own drawer implies, "Visits so far: 11
   * · last 22 Aug", and the head's "Replacement due".
   *
   * A count of nought is a true nought and is written as one. A figure nothing
   * records is written in words, never as a dash or a zero (PR #89, PR #100).
   */
  history: {
    title: "History",
    rows: {
      firstFit: "First fit",
      visits: "Visits",
      services: "Service visits",
      replacements: "Replacements",
      lastVisit: "Last visit",
      replacement: "Replacement due",
      spend: "Paid",
    },
    /** A client we have never fitted, and one whose earlier visits FSM never held, read the same from here. */
    noFirstFit: "No first fit on record",
    noVisit: "No visit done yet",
    /** The day ops order a piece against, with the piece it is for, as board D2's task queue names one. */
    due: (date: string, piece: string) => `${date} · ${piece}`,
    noPiece: "No piece fitted, so no date",
    note:
      "Counted from the visits and payments themselves when this page is opened. " +
      "Nothing keeps a tally, so no figure here can drift from the records beneath it.",
  },
} as const;

export const waitlist = {
  title: "Waitlist",
  columns: ["Pincode", "Area", "Count", "Oldest", "Ref", "Alerts"],
  /** An area or a date the pincode table has nothing for, written as the design's tables write a gap. */
  unknown: "—",
  /** A pincode we already come to. PLACEHOLDER: the board draws only those waiting. */
  live: "Live",
  choose: (pincode: string, area: string) => `Mark ${pincode} live, ${area}`,
  /**
   * PLACEHOLDER: a pincode served without its waitlist being told, as the
   * Settings screen served them until it launched them too (FEO-02). Choosing
   * it asks who is still to be told.
   */
  tell: (pincode: string, area: string) => `Tell those waiting in ${pincode}, ${area}`,
  // PLACEHOLDER: the board draws no empty waitlist.
  empty: "Nobody is waiting outside the areas we serve.",
  // PLACEHOLDER: the table lists the two hundred pincodes that have waited longest.
  more: "More pincodes have people waiting than are listed. These are the ones who have waited longest.",
  launch: {
    label: (pincode: string) => `Mark ${pincode} live`,
    /** PLACEHOLDER: the panel's head for a pincode already live. */
    tellLabel: (pincode: string) => `Tell those waiting in ${pincode}`,
    title: (alerts: number) =>
      alerts === 0 ? "This messages nobody" : `This messages ${String(alerts)} ${alerts === 1 ? "person" : "people"}`,
    rows: { waiting: "On the list", alerts: "Opted in to alerts", referred: "Held referral invites" },
    /** PLACEHOLDER: the board's launch sends today; the API takes the day a technician starts coming. */
    date: "Launch date",
    dateHint: "The day a technician starts coming. A held referral invite lapses twelve months from it.",
    /** PLACEHOLDER: where the area's name in the message comes from, and where it is changed (OPS-13). */
    named: "The message names the area as Settings has it.",
    rename: "Change the name",
    /**
     * What each of them gets. The words are launch_alert_v1's in
     * src/config/message-templates.ts, which is what the queue actually sends;
     * the first name is theirs, so the preview shows the placeholder.
     * test/node/ops-content.test.ts holds the two together.
     */
    message: (area: string, bookingUrl: string) =>
      `Hello {first name}, we now come to ${area}. Your free consultation can be booked here: ${bookingUrl}`,
    /** The board's "Send to 84"; with nobody to message, the press only marks the pincode live, and says so. */
    send: (alerts: number) => (alerts === 0 ? "Mark it live" : `Send to ${String(alerts)}`),
    sending: "Sending",
    cancel: "Not now",
    /** The board's note beneath the panel, with the figures filled in. */
    note: (quiet: number) => {
      if (quiet === 0) return "Everyone on the list asked to be told.";
      const who = quiet === 1 ? "The 1 who did not opt in is" : `The ${String(quiet)} who did not opt in are`;
      return `${who} not messaged. The count shows both so the gap is visible.`;
    },
    /** PLACEHOLDER: for a pincode already live, those not messaged include whoever was told before. */
    toldNote: "Nobody who has been told is told again.",
    done: (alerts: number) =>
      alerts === 0 ? "Marked live. Nobody was messaged." : `Launched. ${String(alerts)} on their way.`,
    errors: {
      not_found: "We have no such pincode.",
      offline: "You are offline. Connect, then try again.",
      unknown: "That did not go through. Please try again.",
    } as Readonly<Record<string, string>>,
  },
} as const;

/**
 * Board D1's queue. The board draws the day's money over "No-shows and late
 * cancellations", and beside it a disputed charge ruled on with Refund or
 * Uphold. Only the no-show cases and their three facts have a route, so only
 * they are here (docs/open-points.md, item 57).
 */
export const noShows = {
  title: "No-shows",
  /**
   * Board D1's first card: the day's money, over the charges it was kept on.
   * The card carries no heading on the board and names no day, so both are
   * placeholders. Two of its three figures are read from the payments
   * themselves; the third has no source at all (docs/open-points.md, item 57).
   */
  money: {
    /** PLACEHOLDER: the board's card has no heading, and a panel needs a name to be read by. */
    title: "Today",
    /** The board's own three, in its order and its words. */
    figures: { collected: "Collected today", processing: "Refunds processing", charged: "Charges and no-shows" },
    /** Under "Refunds processing", which counts what has not gone back yet. */
    refunded: (amount: string) => `${amount} went back today`,
    /**
     * Under "Charges and no-shows". Ops rule a no-show on the evidence and the
     * charge itself is applied at P2-M5, so nothing records what one was
     * charged: the figure above holds what was kept and says what it leaves out
     * rather than pricing a no-show the system never priced.
     */
    uncharged: (count: number) => `${String(count)} ${count === 1 ? "no-show" : "no-shows"} not charged yet`,
    /** PLACEHOLDER: the board draws the dispute as a card of its own, with Refund and Uphold. */
    noDispute:
      "No client can raise a dispute yet, so none is shown. Refund and Uphold rule on a record that is still to be built.",
    charges: {
      /** The board's own heading over the list. */
      title: "No-shows and late cancellations",
      /** The board's line: the client, then what it was. */
      noShow: (name: string) => `${name} · no-show`,
      cancelled: (name: string) => `${name} · cancelled late`,
      moved: (name: string) => `${name} · moved late`,
      /** The board's evidence beneath a late cancellation: "Cancelled 9:14 am · visit was 10 am". */
      changed: (at: string, was: string) => `Cancelled ${at} · visit was ${was}`,
      /**
       * A charged no-show's evidence. The board writes the three facts here; they
       * stand on the queue beneath, which is where a case is ruled on
       * (docs/fidelity-method.md).
       */
      attended: (technician: string, was: string) => `${technician} attended · visit was ${was}`,
      /** PLACEHOLDER: a no-show whose case has lost the technician who attended. */
      unattended: (was: string) => `Nobody was home · visit was ${was}`,
      /** PLACEHOLDER: a charge on a visit that carries no start time. */
      undated: "time unknown",
      /** PLACEHOLDER: a charge on a visit FSM never matched to one of our people. */
      unknown: "Client unknown",
      /**
       * Words where the amount stands, so a no-show's line cannot be read as
       * money that was taken (ADR 0036, PR #89).
       */
      noAmount: "Not charged yet",
      /** PLACEHOLDER: the board draws two charges and no empty day. */
      empty: "Nothing was charged today.",
    },
  },
  queue: {
    /**
     * PLACEHOLDER: the board heads the list "No-shows and late cancellations".
     * Nothing lists a late cancellation, and what is here is a queue, as board
     * C1's "Held for review" is.
     */
    title: "Waiting for a decision",
    /** The visit the case belongs to: "Visit of Sat 19 Sep". */
    visit: (date: string) => `Visit of ${date}`,
    /** PLACEHOLDER: a case whose appointment carries no date. */
    undated: "Visit, date unknown",
    /** PLACEHOLDER: the client of an erased record, who has no name left to show. */
    erased: "Client erased",
    attended: (technician: string) => `${technician} attended`,
    /**
     * The board's four rows, in its own words, and two it does not letter: the
     * window the visit was booked for, and when the check-in reached us. A phone's
     * clock is the technician's to set, so ops rule on both clocks
     * (docs/decisions/0065-a-technicians-writes-reach-fsm.md).
     */
    facts: {
      booked: "Booked",
      checkIn: "Check-in",
      // PLACEHOLDER: shown only when the phone gave a time the bounds would not take.
      claimed: "The phone said",
      received: "Reached us",
      distance: "Distance",
      whatsapp: "WhatsApp",
      waited: "Waited",
    },
    /** "Sat 19 Sep, 9 am to 12". */
    booked: (date: string, from: string, to: string) => `${date}, ${from} to ${to}`,
    /** PLACEHOLDER: "2:08 pm · 5 h 8 m after the booked start", or before it, or at it. */
    checkIn: (time: string, offset: string) => `${time} · ${offset}`,
    after: (span: string) => `${span} after the booked start`,
    before: (span: string) => `${span} before the booked start`,
    onTime: "at the booked start",
    /** "5 h 8 m", "48 m", "1 h", as board D3 writes a length. */
    span: (hours: number, minutes: number) => {
      if (hours === 0) return `${String(minutes)} m`;
      return minutes === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(minutes)} m`;
    },
    /** The board writes "240 m · over 200 m fence"; the route gives the distance, not the radius in force. */
    distance: (metres: number) => `${String(metres)} m`,
    /**
     * An address with no coordinates cannot be measured against, so the route
     * carries no distance (ADR 0036). Words rather than a number, because ops
     * charge a client on these facts and nothing was measured here at all.
     */
    unmeasured: "Not measured · the address has no location",
    /**
     * What became of the reminder, dated, since it goes the evening before. A
     * reminder never sent is not one sent and never delivered.
     */
    message: {
      delivered: (when: string) => `Delivered ${when}`,
      // PLACEHOLDER: the board's receipt always arrived; the other four are ours.
      sent: "Sent, and never delivered",
      no_consent: "No reminder sent · the client has not agreed to WhatsApp about visits",
      not_sent: "Not sent",
      none: "No reminder was sent",
    },
    /** "Fri 18 Sep, 6:03 pm". */
    dated: (date: string, time: string) => `${date}, ${time}`,
    /**
     * The board's "15 min · closed 11:47", counted from the check-in to the
     * close, not the wait the rules asked for. When the check-in reached us
     * late, how long it had been with us is said as well.
     */
    waited: (minutes: number, closed: string) => `${String(minutes)} min · closed ${closed}`,
    waitedBoth: (minutes: number, withUs: number, closed: string) =>
      `${String(minutes)} min by the phone, ${String(withUs)} since it reached us · closed ${closed}`,
    notClosed: "Not closed",
    /**
     * Board D1's field beneath the evidence, "Your note · required", which the
     * board draws on the dispute. A ruling needs its reason either way, and the
     * server refuses one without it (src/policy/decision-reasons.ts).
     */
    reason: {
      label: "Your note · required",
      placeholder: "Why you are charging or waiving",
      hint: "Kept with the ruling, under your name.",
    },
    /**
     * PLACEHOLDER: the board's buttons are Refund and Uphold, which rule on a
     * dispute. The route charges the visit or waives it, and nothing records a
     * dispute at all.
     */
    charge: "Charge",
    waive: "Waive",
    /** PLACEHOLDER: a charge is asked about once more, since it cannot be taken back here. */
    confirm: (name: string, day: string) => `Charge ${name} for the visit of ${day}? It cannot be undone here.`,
    // PLACEHOLDER: a visit that carries no date, as a charge asked about names it.
    noDay: "a day not recorded",
    confirmCharge: "Charge the visit",
    back: "Back",
    deciding: "Deciding",
    /**
     * PLACEHOLDER: the board draws no note beneath the queue, and no amount anywhere. A charge keeps what the visit
     * took, as a cancel inside 24 hours does; what a waiver gives back waits for the owner (BIZ-28).
     */
    note: "Charging records the decision and keeps what the visit took. Waiving records it too, but refunds nothing and returns no credit yet: settle that with the client by hand. Either way the client is told on WhatsApp, never your note.",
    /** PLACEHOLDER: the board draws no empty queue. */
    empty: "No no-show is waiting for a decision.",
    errors: {
      not_found: "Someone has ruled on this one already. Reload to see the queue as it stands.",
      offline: "You are offline. Connect, then try again.",
      unknown: "That did not go through. Please try again.",
    } as Readonly<Record<string, string>>,
  },
} as const;

/**
 * Board D2's queue. A task is not a record: it is a row in a queue the database
 * already keeps, read when ops look (src/policy/tasks.ts). The board draws four
 * groups, of which two have something behind them; the others here are queues
 * it does not draw (docs/open-points.md, item 58).
 */
export const tasks = {
  title: "Tasks",
  /** The head's count, in oxblood, as the board writes "4 overdue". */
  overdue: (count: number) => `${String(count)} overdue`,
  /** Each group, lettered in small caps as the board letters its own two. */
  groups: {
    // PLACEHOLDER: a group the board does not draw (docs/decisions/0069-dispatch-under-concurrency.md).
    untold_move: "Call about a move",
    // PLACEHOLDER: two groups the board does not draw (docs/decisions/0074-hand-offs-and-messages.md).
    leave_conflict: "Job on a day off",
    address_to_confirm: "Address to confirm",
    consultation_request: "Consultation request",
    replacement_order: "Replacement order",
    // PLACEHOLDER: a group the board does not draw (docs/decisions/0074-hand-offs-and-messages.md).
    partial_visit: "Visit left partly done",
    referral_review: "Referral review",
    no_show_decision: "No-show decision",
    number_change: "Number change",
    erasure_request: "Erasure request",
    // PLACEHOLDER: a group the board does not draw (docs/decisions/0072-ops-clients-and-queues.md).
    grievance: "Grievance",
    // PLACEHOLDER: two groups the board does not draw (docs/decisions/0067-alerts-and-silent-failures.md).
    draft_invoice: "Draft invoice",
    erasure_unfinished: "Erasure left in FSM",
  } as Readonly<Record<string, string>>,
  /** The first line of a no-show whose client has since been erased: the visit, which is all that is left. */
  visit: (date: string) => `Visit of ${date}`,
  /** PLACEHOLDER: an erased client has no name left to show, so the line says when they were erased. */
  erased: (date: string) => `Client erased ${date}`,
  /** PLACEHOLDER: a queue whose row has lost the client it was about. */
  unknown: "Client unknown",
  /** The client's page, which the board draws no way to. */
  open: (name: string) => `Open ${name}`,
  /**
   * PLACEHOLDER: the section each task is decided in, and a way to its row
   * there. The board draws no way of acting on a task; the section itself
   * decides nothing.
   */
  decide: {
    untold_move: "Record the call in Dispatch",
    leave_conflict: "Move it in Dispatch",
    referral_review: "Decide it in Referrals",
    no_show_decision: "Rule on it in No-shows",
    number_change: "Decide it in Number changes",
    erasure_request: "Decide it in Deletion requests",
    grievance: "Answer it in Grievances",
  } as Readonly<Record<string, string>>,
  /** PLACEHOLDER: a group longer than the board lists: its count is all of them. */
  shown: (shown: number, count: number) => `The ${String(shown)} longest waits of ${String(count)}.`,
  /** PLACEHOLDER: more were waiting than one look reads. */
  truncated: "More are waiting than one look reads, so a count here may be short.",
  /** The second line, one per group: the one fact the group turns on. */
  subs: {
    /** PLACEHOLDER: "Moved to Wed 23 Sep, 9 am; not on WhatsApp": ops call, then say so on the dispatch board. */
    untold_move: (when: string) => `Moved to ${when}; not on WhatsApp`,
    /** PLACEHOLDER: "Wed 23 Sep, 10:30 am, and Sameer is away": move it on the dispatch board, or take the leave back. */
    leave_conflict: (when: string, technician: string) => `${when}, and ${technician} is away`,
    /**
     * PLACEHOLDER: "Visit Tue 22 Sep, 10 am; no address yet". Only the client can save one, in the app, whose Home
     * asks for it; the task goes when they do.
     */
    address_to_confirm: (when: string) => `Visit ${when}; no address yet`,
    /** "Asked for 23 Sep 2026, morning": the day nobody could book for them, self-serve booking being off. */
    consultation_request: (day: string, when: string) => `Asked for ${day}, ${when}`,
    /** "MM-STD-4417-C · due 1 Mar 2028". The board writes the supplier's lead time too; nothing records one. */
    replacement_order: (piece: string, due: string) => `${piece} · due ${due}`,
    /** PLACEHOLDER: "The piece was not ready · 20 Sep": book the visit that finishes it. The technician's words. */
    partial_visit: (reason: string, date: string) => `${reason} · ${date}`,
    partialReasons: {
      client_stopped_it: "Client stopped it partway",
      piece_not_ready: "The piece was not ready",
      client_unwell: "Client unwell",
      more_time_needed: "More time needed",
    } as Readonly<Record<string, string>>,
    /** PLACEHOLDER: a visit closed partial in FSM's own screen, with no reason from the technician. */
    noReason: "No reason recorded",
    no_show_decision: (technician: string) => `${technician} attended`,
    number_change: "Both numbers proven by code",
    erasure_request: "Asked for in the client's own app",
    // PLACEHOLDER: a concern about their data, which the app promises an answer to within 30 days.
    grievance: "Raised in the client's own app",
    // PLACEHOLDER: the client cannot open the invoice until somebody sends it in Books.
    draft_invoice: (visit: string) => `Visit of ${visit}, still a draft in Books`,
    // PLACEHOLDER: the sweeper has stopped asking FSM; the contact is anonymised by hand.
    erasure_unfinished: (contact: string) => `FSM contact ${contact} still holds their details`,
    // PLACEHOLDER: a held grant whose fraud signals were not recorded.
    unknown: "Held for review",
  },
  /** The last column, as the board writes it: "2 days", "1 day", "Today", "Overdue 3". */
  sla: {
    today: "Today",
    left: (days: number) => `${String(days)} ${days === 1 ? "day" : "days"}`,
    over: (days: number) => `Overdue ${String(days)}`,
  },
  /** PLACEHOLDER: the board draws no note, and a queue with no buttons has to say where the work is done. */
  note: "Nothing is closed here. A task leaves this list when the thing itself is decided, where it is decided.",
  /** PLACEHOLDER: the board draws twelve tasks and no empty list. */
  empty: "Nothing is waiting.",
} as const;

/**
 * Board D3's roster. The board draws five columns; four are answered, and the
 * fifth, Skill, is recorded nowhere (docs/open-points.md, item 59). The phones
 * the board does not draw sit beneath each name.
 */
export const technicians = {
  title: "Technicians",
  /**
   * Four of board D3's five columns, and Leave where it draws Skill: nothing
   * records a skill, and a day off is what ops need to see down the roster.
   */
  columns: ["Technician", "Zone", "Jobs", "Avg service", "Leave"],
  /**
   * PLACEHOLDER: the technician's name opens their phones and their leave,
   * which the board's rows have no room for, in a panel over the roster.
   */
  open: (name: string) => `${name}: phones and leave`,
  close: "Close",
  /** The Leave column: away today, the first day of leave to come, or nothing. */
  away: "Away",
  from: (date: string) => `From ${date}`,
  /** A zone the FSM mirror has nothing for, written as the design's tables write a gap. */
  unknown: "—",
  // PLACEHOLDER: the board draws no console without technicians.
  empty: "No technician is active.",
  /** The two columns counted from the jobs themselves (src/domain/technician-work.ts). */
  work: {
    /** The average itself, as the board writes it: "1 h 24 m", and "48 m" under the hour. */
    average: (hours: number, minutes: number) =>
      hours === 0
        ? `${String(minutes)} m`
        : minutes === 0
          ? `${String(hours)} h`
          : `${String(hours)} h ${String(minutes)} m`,
    /**
     * PLACEHOLDER: how far over the planned length reads as running over. The
     * board letters 1 h 48 m in oxblood, 18 minutes past the 90 a service visit
     * is planned for, and leaves 1 h 31 m quiet. It writes no rule, and this is
     * where we have drawn it, as the dispatch board's peak is drawn.
     */
    overBy: 15,
    /** When the phone timed fewer jobs than were finished, the average says what it is of. */
    base: (timed: number, jobs: number) => `${String(timed)} of ${String(jobs)}`,
    /** Beneath the table, where the board writes its own note: what the two columns count. */
    period: (from: string, to: string) =>
      `Jobs finished from ${from} to ${to}. Average service is against the length each visit was planned for, over the jobs the phone timed from Start to the outcome.`,
    /** The board's fifth column, which no route can answer (docs/open-points.md, item 59). */
    skill: "Nothing records what a technician is trained for, so the board's Skill column is not drawn.",
  },
  phones: {
    title: "Phones",
    /** PLACEHOLDER: a phone whose browser gave no label at login. */
    unlabelled: "Phone",
    /**
     * PLACEHOLDER: "Chrome on Android · 3f9a": the browser, and the end of the
     * app's own ID for the phone, so two phones alike can be told apart.
     */
    label: (label: string, id: string) => `${label} · ${id}`,
    seen: (date: string) => `last used ${date}`,
    none: "No phone logged in.",
    revoke: "Revoke",
    /** The button's whole name, since a roster holds many phones and each button says "Revoke". */
    revokeLabel: (phone: string, technician: string) => `Revoke ${phone} of ${technician}`,
    confirm: "Revoke this phone",
    cancel: "Keep it",
    revoking: "Revoking",
    revoked: (date: string) => `Revoked ${date}`,
    /** PLACEHOLDER: the board draws no revoke, so nothing writes what one does. */
    warning: "The session ends, and the phone drops its cached jobs when it is next online.",
    errors: {
      not_found: "That phone is not this technician's any more. Reload to see the roster as it stands.",
      offline: "You are offline. Connect, then try again.",
      unknown: "That did not go through. Please try again.",
    } as Readonly<Record<string, string>>,
  },
  /**
   * PLACEHOLDER: the design draws no leave anywhere, because FSM was thought to
   * hold it. It does not (ADR 0062), so leave is recorded here and every line
   * below is ours.
   */
  leave: {
    title: "Leave",
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
    /** Taking leave back, which lets those days be worked again. */
    take: "Take it back",
    takeLabel: (period: string, technician: string) => `Take back ${technician}'s leave, ${period}`,
    taking: "Taking it back",
    effect: "Nobody can be booked or assigned on these days until the leave is taken back.",
    // PLACEHOLDER: leave recorded over jobs already booked moves none of them (OPS-07).
    stranded: {
      title: (count: number) =>
        `${String(count)} ${count === 1 ? "job is" : "jobs are"} still booked on this leave. Recording it moved none.`,
      job: (when: string, client: string) => `${when} · ${client}`,
      noClient: "No client on our records",
      move: "Move them on the dispatch board",
    },
    errors: {
      invalid_request:
        "Those dates do not work: the last day cannot come before the first, and leave runs a year at most.",
      not_found: "That technician or that leave is no longer here. Reload to see the roster as it stands.",
      offline: "You are offline. Connect, then try again.",
      unknown: "That did not go through. Please try again.",
    },
  },
} as const;

/*
 * The three sections a client's rights over their own data put in front of ops
 * (docs/decisions/0049-dpdp.md, docs/decisions/0042-client-profile.md). The
 * design draws no board for any of them — they came out of the P2-M6 proof,
 * which found all three API-only — so every line below is a placeholder, and
 * each queue is built as the boards' own queues are (C1 and D1).
 */

/** How long a request has left before the time we have promised runs out, as board D2 words its column. */
export const waiting = {
  left: (days: number) => `${String(days)} ${days === 1 ? "day" : "days"} left`,
  today: "Due today",
  over: (days: number) => `Overdue ${String(days)}`,
} as const;

export const grievances = {
  title: "Grievances",
  queue: {
    title: "Open grievances",
    /**
     * The days the app promises the client an answer within, which counsel has
     * still to confirm (docs/open-points.md, item 42).
     * test/node/ops-content.test.ts holds this to the app's own words.
     */
    answerDays: 30,
    /** Beneath the name: the number to answer on, and the day it was raised. */
    raised: (mobile: string, date: string) => `${mobile} · raised ${date}`,
    label: "Your answer",
    hint: "Kept with the grievance, under your name. The audit log records that you answered it.",
    send: "Record the answer and close it",
    sending: "Closing",
    empty: "No grievance is open.",
    /** Recording an answer sends nothing: the client hears from whoever answers them. */
    note: (days: number) =>
      `The client is told in the app that we answer within ${String(days)} days, on WhatsApp. ` +
      "Nothing here messages them: send your answer, then record it.",
    errors: {
      not_found: "Someone has answered this one already. Reload to see the queue as it stands.",
      offline: "You are offline. Connect, then try again.",
      unknown: "That did not go through. Please try again.",
    } as Readonly<Record<string, string>>,
  },
} as const;

export const deletions = {
  title: "Deletion requests",
  queue: {
    title: "Waiting for a decision",
    /** The seven days a request is processed within, which run from the day it was made (ADR 0049). */
    processDays: 7,
    requested: (mobile: string, date: string) => `${mobile} · requested ${date}`,
    delete: "Delete the account",
    reject: "Reject the request",
    /**
     * A queue holds many rows and each button says the same thing, so the
     * destructive one names whose account it is, as board D3's revoke does.
     */
    deleteLabel: (name: string) => `Delete the account of ${name}`,
    rejectLabel: (name: string) => `Reject the request of ${name}`,
    confirmLabel: (name: string) => `Deleting the account of ${name}`,
    warning: "This erases the client now. It cannot be undone, and there is no copy to put back.",
    /** What the erasure destroys, in the order src/domain/erasure.ts destroys it. */
    deleted: {
      title: "Deleted",
      items: [
        "Every photograph of them, their visits' and their try-ons', the files as well as the records",
        "Their referral card, so an invite they sent shows the house card from now on",
        "Their saved addresses, and any number change under way",
        "Their name, number and e-mail on the record, and the words of any grievance",
        "Their sessions, so their phone is signed out at once",
      ],
    },
    /** What stays, and why. The eight years are the app's own words to the client. */
    kept: {
      title: "Kept",
      items: [
        "Their visits, payments, refunds and credits, as records",
        "Their invoices in Books, eight years, by law",
        "Their Zoho record and their FSM contact, blanked within a few minutes",
      ],
    },
    /** The runbook's first step, "Check the request comes from the number's owner". */
    checked: "I have confirmed this request with the client, on their own number.",
    confirm: "Delete this account",
    cancel: "Keep the account",
    deleting: "Deleting",
    reason: {
      label: "Why you are rejecting it",
      hint: "Kept with the decision, under your name.",
      confirm: "Reject this request",
      cancel: "Leave it waiting",
    },
    rejecting: "Rejecting",
    empty: "No deletion request is waiting.",
    note: (days: number) =>
      `Each request is processed within ${String(days)} days of being made. ` +
      "Ops are alerted once when one has waited five.",
    errors: {
      not_found: "Someone has decided this one already. Reload to see the queue as it stands.",
      /** The API refuses while something is still owed (docs/decisions/0066-erasure-all-or-nothing.md). */
      visit_booked:
        "They still have a visit booked, so nothing was erased. Cancel it in FSM, and refund what they paid, then delete.",
      payment_held:
        "We hold a payment of theirs with no visit behind it, so nothing was erased. Refund it, then delete.",
      offline: "You are offline. Connect, then try again.",
      unknown: "That did not go through. The client has not been erased.",
    } as Readonly<Record<string, string>>,
  },
} as const;

export const numberChanges = {
  title: "Number changes",
  queue: {
    title: "Waiting for ops",
    /** The number they had, and the one they are moving to. */
    move: (from: string, to: string) => `${from} → ${to}`,
    requested: (date: string) => `Requested ${date}`,
    /** The rule the change follows, quoted in migrations/0008_profile.sql. */
    proven: "A code went to both numbers, and both were entered.",
    effect: "Confirming moves the client to the new number. They sign in with it from then on.",
    confirm: "Confirm the change",
    reject: "Reject",
    reason: {
      label: "Why you are rejecting it",
      // PLACEHOLDER: the client's profile shows this reason for thirty days (OPS-09).
      hint: "Kept with the decision, under your name. The client reads it in the app.",
      confirm: "Reject the change",
      cancel: "Leave it waiting",
    },
    deciding: "Deciding",
    empty: "No number change is waiting.",
    errors: {
      number_in_use: "Another client holds that number already. Nothing was changed.",
      not_found: "Someone has decided this one already. Reload to see the queue as it stands.",
      offline: "You are offline. Connect, then try again.",
      unknown: "That did not go through. Nothing was changed.",
    } as Readonly<Record<string, string>>,
  },
} as const;

/**
 * Settings: the business inputs ops set for themselves. The design draws this
 * section and letters nothing inside it (docs/decisions/0061-ops-editable-inputs.md,
 * docs/fidelity-method.md), so every line below is ours. Each field says its
 * unit and what the figure may be before it is typed, not after it is refused,
 * and a change that cannot be taken back is shown before it is made
 * (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).
 */
export const settings = {
  title: "Settings",
  sub: "A change takes effect within a minute. No release is needed.",
  tabs: { rules: "Rules", prices: "Prices", area: "Service area" },
  rules: {
    title: "Rules",
    allowed: (min: number, max: number, unit: string) => `${String(min)} to ${String(max)} ${unit}, a whole number`,
    setBy: (who: string, when: string) => `Set by ${who} on ${when}`,
    committed: "Nobody has set this, so the standard figure stands.",
    save: "Save",
    saving: "Saving",
    saved: "Saved.",
    reset: "Go back to the standard figure",
    /** The open-keyed rule's extra row: a base FSM names, and the cycle for it. */
    keyName: "Base, exactly as FSM names it",
    keyValue: "Days",
    add: "Add",
    defaultKey: "Every other base",
    /**
     * The boxes of a rule with one figure per key: the kinds of visit and the
     * task queues, as the rest of the console names them. A base ops name
     * themselves shows as they typed it.
     */
    keyNames: {
      no_show_wait_min: dispatch.typeNames,
      task_sla_hours: tasks.groups,
    } as Readonly<Record<string, Readonly<Record<string, string>>>>,
    /** The rule's name, or one of its boxes, and what the API said of it. */
    outside: (field: string) => `${field} is outside what this rule allows. Nothing was changed.`,
    errors: {
      invalid_request: "That figure is outside what this rule allows. Nothing was changed.",
      offline: "You are offline. Connect, then try again.",
      unknown: "That did not go through. Nothing was changed.",
    } as Readonly<Record<string, string>>,
  },
  prices: {
    title: "Prices",
    note: "A price applies from the day you give it and never before, so nothing already invoiced moves.",
    columns: ["Item", "Tier", "Before GST", "GST", "From", "State"],
    /** What the book prices, as the rest of the console names the visits. */
    items: {
      consultation: "Consultation",
      first_fit: "First fit",
      service: "Service visit",
      replacement: "Replacement",
      late_fee_first_fit: "Late fee on a first fit",
      late_fee_replacement: "Late fee on a replacement",
    } as Readonly<Record<string, string>>,
    inForce: "In force",
    scheduled: "To come",
    spent: "Past",
    percent: (value: number) => `${String(value)}%`,
    /** "Rs. 2,000 + 18% GST": a price as the confirmation compares two. */
    price: (rupees: string, gst: number) => `${rupees} + ${String(gst)}% GST`,
    form: {
      title: "Set a price",
      item: "Item",
      tier: "Tier",
      /** The last choice under Tier: pricing a kind of base the book has never held (ADR 0061). */
      newTier: "A new tier",
      newTierName: "The new tier's name",
      newTierHint: "Small letters, digits and _, starting with a letter: lace, or mono_base.",
      /** Under the item and tier, what they cost today, which the boxes below start from. */
      now: (price: string, since: string) => `Now ${price}, since ${since}.`,
      none: "Nothing is priced for this tier yet.",
      amount: "Price before GST, in rupees",
      amountHint: (max: string) => `Whole rupees, up to ${max}.`,
      gst: "GST",
      gstHint: (max: number) => `A whole percentage, 0 to ${String(max)}.`,
      from: "Applies from",
      fromHint: "Today or a day after it.",
      save: "Set this price",
      saving: "Setting",
      saved: "The price is set.",
      /** The check before anything is sent: what the item costs now, and what it will. */
      confirm: {
        title: "Check the change",
        change: (item: string, tier: string, was: string, now: string, from: string) =>
          `${item}, ${tier}: ${was} → ${now}, from ${from}.`,
        nothing: "nothing",
        gstChanges: (was: number, now: number) => `GST changes from ${String(was)}% to ${String(now)}%.`,
        sameDay: "A price is already set from that day. This replaces it.",
        send: "Set this price",
        back: "Change it",
      },
    },
    withdraw: {
      button: "Take back",
      label: (item: string, from: string) => `Take back the ${item} price from ${from}`,
      question: (from: string) => `Take back the price from ${from}? The price before it goes on applying.`,
      confirm: "Take it back",
      keep: "Keep it",
      taking: "Taking it back",
      done: "The price is taken back.",
    },
    /** A refusal names the box it came from (src/routes/ops-settings.ts); these are said of each. */
    errors: {
      item: "The book does not price that item. Nothing was changed.",
      tier: "A tier's name is small letters, digits and _, starting with a letter. Nothing was changed.",
      amount_ex_gst: "A price is in whole rupees, inside the range under the field. Nothing was changed.",
      gst_percent: "GST is a whole percentage, inside the range under the field. Nothing was changed.",
      valid_from: "A price applies from today or a day after it. Nothing was changed.",
      not_found: "That price is no longer in the book. The table now shows it as it stands.",
      offline: "You are offline. Connect, then try again.",
      unknown: "That did not go through. Nothing was changed.",
    } as Readonly<Record<string, string>>,
    /** Taking back a price that applies already, or has applied: it may stand on an invoice. */
    withdrawErrors: {
      valid_from: "That price applies already, so it stays in the book.",
    } as Readonly<Record<string, string>>,
  },
  area: {
    title: "Service area",
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
    bulk: {
      serve: (city: string) => `Serve all of ${city}`,
      stop: (city: string) => `Stop serving ${city}`,
    },
    /**
     * Serving a pincode is a launch: whoever waits there and asked to be told
     * is messaged when it is saved, as marking it live on the waitlist does.
     * So the save that would message anyone says so first.
     */
    launch: {
      title: (people: number) => `This messages ${String(people)} ${people === 1 ? "person" : "people"}`,
      line: (pincode: string, area: string, people: number) =>
        `${pincode}, ${area}: ${String(people)} waiting ${people === 1 ? "asks" : "ask"} to be told.`,
      note: "Serving a pincode tells those on its waitlist who asked to hear from us, on WhatsApp, once.",
      send: (people: number) => `Save and message ${String(people)}`,
      cancel: "Not now",
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
      no_service_area: "That would leave no pincode served, and every client on the waitlist. Nothing was changed.",
      /** A pincode we do not hold: the file is reference data, not a way to add one. */
      invalid_request: "That names a pincode we do not hold. Nothing was changed.",
      offline: "You are offline. Connect, then try again.",
      unknown: "That did not go through. Nothing was changed.",
    } as Readonly<Record<string, string>>,
  },
} as const;
