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
   * board rules on has no record behind it (docs/open-points.md, item 60).
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
    // PLACEHOLDER: no board draws stock; the owner ruled it is kept here (docs/decisions/0087-consumables-and-stock.md).
    stock: "Stock",
    grievances: "Grievances",
    "deletion-requests": "Deletion requests",
    "number-changes": "Number changes",
    settings: "Settings",
  },
  /** The browser tab's title: "Services and prices · Settings · Mane Man operations". */
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
  /** PLACEHOLDER: a person Access lets in whom the enforced Staff list does not name. */
  notListed: "You are not on the Staff list, so the console is closed to you. Ask the owner to add you.",
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
   * owner's to rule (docs/open-points.md, item 53); test/node/ops-content.test.ts
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
    // PLACEHOLDER: at_visit, a consultation and fit in one visit, paid for once the client is fitted (ADR 0105).
    badges: { prepaid: "Prepaid", credit: "Credit", free: "Free", at_visit: "Pays once fitted" } as Readonly<
      Record<string, string>
    >,
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
    /**
     * The board's extra line inside the notice the visit was sold under, which the board writes as 24 hours. The
     * client keeps the free change they had: their own change counts from the time before we moved it (ADR 0096).
     */
    soon: (hours: number) =>
      `This visit is inside ${String(hours)} hours. The client is not charged, because we moved it.`,
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
      // PLACEHOLDER: an invite ops attached after the friend's first fit (the owner's ruling of 30 September 2026).
      attached_after_fit: "Attached after the first fit",
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
   * is the record's own address and visits, which the page already holds, and
   * the form to record an address the client gives ops on the phone, which
   * searches for their building and saves it (docs/decisions/0092-task-owners.md).
   */
  visits: {
    address: "Visits go to",
    noAddress: "No address saved yet. The client adds it in their app, or gives it to you on the phone.",
    access: "Access",
    // PLACEHOLDER: the address a client gave ops on the phone, which no board draws (docs/decisions/0092-task-owners.md).
    landmark: "Landmark",
    givenToOps: "Given on the phone",
    /** "To priya@maneman.in, 28 Sep 2026". */
    givenTo: (who: string, when: string) => `To ${who}, ${when}`,
    /** "Closed without a follow-up by priya@maneman.in, 28 Sep 2026", and ops' reason after it. */
    closedWithout: (who: string, when: string) => `Closed without a follow-up by ${who}, ${when}`,
    /** The form a member of staff saves an address a client gives them with, which the app's own save follows. */
    given: {
      open: "Record an address they give you",
      change: "Change it to one they give you",
      title: "An address the client gave you",
      note:
        "Saved as the client's address, as their own save in the app is, and marked as given to you. They see it in " +
        "their app, and may change it there.",
      building: {
        label: "Search for their building",
        hint: "Type the building or society, and choose it, to give the technician a pin.",
        unavailable: "Search is unavailable just now. Type the address below instead.",
        found: (count: number) => (count === 1 ? "1 building found" : `${String(count)} buildings found`),
        // Google asks for their name against suggestions shown without a map.
        attribution: "Google Maps",
      },
      flat: "Flat or house number",
      floor: "Floor (optional)",
      tower: "Tower or block (optional)",
      line1: "Building, society or street",
      line2: "Street (optional)",
      landmark: "Landmark (optional)",
      locality: "Sector or area",
      city: "City",
      pincode: "Pincode",
      accessNotes: "Access notes (optional)",
      accessHint: "A gate code, or where to park. The technician sees it the day before the visit.",
      invalid: "Fill in the flat or house number, the building or street, the area, the city and a six-digit pincode.",
      save: "Save their address",
      saving: "Saving…",
      cancel: "Cancel",
      saved: "Saved as their address, marked as given to you.",
      failed: "That did not save. Try again.",
    },
    upcoming: "To come",
    past: "Done",
    columns: ["Date", "Time", "Visit", "Technician", "State", "Discount code"],
    /**
     * PLACEHOLDER: a discount code on a visit, which no board draws (docs/decisions/0108-discount-codes.md).
     * Entered or taken off only while the visit is not paid for or invoiced.
     */
    code: {
      none: "None",
      /** "TENOFF, Rs. 200 off": what it takes off before GST, once the visit's price is known. */
      applied: (code: string, off: string | null) => (off === null ? code : `${code}, ${off} off`),
      givenBy: { client: "by the client", technician: "by the technician", ops: "by ops" } as Readonly<
        Record<string, string>
      >,
      enter: "Enter a code",
      /** The button's whole name, since every row's says the same. */
      enterLabel: (visit: string) => `Enter a discount code on the visit of ${visit}`,
      label: "Discount code",
      apply: "Apply",
      applying: "Applying",
      cancel: "Cancel",
      remove: "Take it off",
      removeLabel: (visit: string) => `Take the discount code off the visit of ${visit}`,
      removing: "Taking it off",
      errors: {
        code_not_applicable: "That code does not apply to this visit.",
        already_discounted: "This visit has a code already.",
        price_settled: "This visit is paid for or invoiced, so its code stays as it is.",
        not_found: "The code is already off this visit.",
        offline: "You are offline. Connect, then try again.",
        unknown: "That did not go through. Nothing was changed.",
      } as Readonly<Record<string, string>>,
    },
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
    /**
     * PLACEHOLDER, all of it: a booking FSM refused five times running, held with its slot and its payment until a
     * try books it, or ops book it in FSM or refund it (docs/decisions/0095-a-booking-fsm-refuses-is-held.md). No
     * board draws it.
     */
    held: {
      title: "Not in FSM yet",
      note:
        "FSM refused these five times running. Nothing is refunded: the slot and the payment are kept until the " +
        "booking is booked, or you refund it.",
      /** "Service visit, Thu 24 Sep, 12:00". */
      what: (visit: string, when: string) => `${visit}, ${when}`,
      paid: (amount: string) => `Paid ${amount}`,
      credit: "A visit credit covers it",
      free: "Nothing to pay",
      refusal: (reason: string) => `FSM said: ${reason}`,
      noRefusal: "FSM gave no reason.",
      retrying: (until: string) => `Tried again automatically until ${until}.`,
      stopped: "No longer tried automatically. Book it in FSM and link it, or refund it.",
      passed: "Its time has passed. Book another time in FSM and link it, or refund it.",
      retry: "Try FSM again",
      trying: "Trying…",
      stop: "Stop trying — I'll book it in FSM",
      stopping: "Stopping…",
      stoppedNow: "The hourly tries are stopped. Book it in FSM, then link it here.",
      link: "Link the visit I booked in FSM",
      linkLabel: "The visit you booked in FSM",
      linkHint:
        "It shows here once FSM has sent it to us, within a minute of booking it. A work order an earlier try " +
        "left is cancelled, so nothing is booked twice.",
      linkNone: "No visit of this kind is booked for them yet. Book it in FSM, then reload this page.",
      linkSave: "Link it",
      linking: "Linking…",
      /** "Thu 24 Sep, 14:00". */
      visit: (date: string, time: string) => `${date}, ${time}`,
      refund: "Refund it",
      refundCheck: (amount: string | null) =>
        amount === null
          ? "Cancel what FSM holds for it, and let the booking go? Nothing was paid for it."
          : `Cancel what FSM holds for it, and refund ${amount} to the client in full?`,
      refundSave: "Refund and let it go",
      refunding: "Refunding…",
      cancel: "Cancel",
      tried: {
        booked: "Booked in FSM. The client is told.",
        given_back: "Its payment had been refunded, or its hold had lapsed, so it was let go.",
        refused: (reason: string) => `FSM refused it again: ${reason}`,
        to_link:
          "A visit of theirs of this kind reached FSM after it was held, so nothing was written. If it is the one " +
          "you booked, link it.",
      },
      linked: "Linked to that visit. The client is told.",
      money: {
        refunded: (amount: string, payment: string) =>
          `Refunded ${amount} in full (Razorpay payment ${payment}). The client is told.`,
        refunded_before: (payment: string) => `Razorpay payment ${payment} was refunded before. The client is told.`,
        nothing_paid: "Nothing was paid for it, so nothing is refunded. The client is told.",
        booked: "A try booked it in FSM meanwhile, so nothing is refunded.",
        refund_refused: (amount: string, payment: string) =>
          `Razorpay refused to refund ${amount} (payment ${payment}), so nothing has gone back and the booking ` +
          "still waits. Try again, or refund it in Razorpay's dashboard and then press Refund it here.",
        // Not refund it in the dashboard: the refund may have been made, and only ours cannot be made twice.
        refund_unanswered: (amount: string, payment: string) =>
          `Razorpay did not say whether it refunded ${amount} (payment ${payment}), so it may have, and the booking ` +
          "still waits. Press Refund it again: Razorpay will not refund it twice.",
      },
      fsm: {
        cancelled: (workOrder: string) => `Its work order ${workOrder} is cancelled in FSM.`,
        not_cancelled: (workOrder: string) =>
          `FSM would not cancel its work order ${workOrder}: cancel it by hand, so no technician goes.`,
        unknown: (booking: string) =>
          `FSM may hold a work order for it: look for "(booking ${booking})" among its work orders and cancel it.`,
      },
      errors: {
        not_found: "It is no longer waiting: it may have been booked or refunded. Reload the page.",
        not_changeable: "Its time has passed, so FSM is not tried again. Link a visit booked in FSM, or refund it.",
        superseded: "A try is writing it to FSM right now. Reload in a minute to see how it went.",
        invalid_request:
          "That visit cannot be this booking. Choose one of theirs, of the same kind, booked in FSM since they paid.",
        unknown: "That did not go through. Try again.",
      } as Readonly<Record<string, string>>,
    },
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
  /*
   * PLACEHOLDER, all of it: no board draws a client's invite. The invite they came with, under Payments beside the
   * credits it grants, or a way to attach one for a friend who booked away from its page
   * (POST /api/clients/{id}/referral; docs/decisions/0089-an-invite-is-not-lost.md).
   */
  invite: {
    title: "Invite",
    code: "Code",
    from: "Sent by",
    erased: "A client since erased",
    grant: "What it earns",
    grants: {
      pending: "Given when this client is fitted",
      held: "Held for review",
      approved: "Given",
      granted: "Given",
      rejected: "Rejected",
      expired: "None: the invite lapsed while they waited",
      clawed_back: "Taken back: the first fit was refunded",
    },
    since: "Since",
    attachedBy: "Attached by",
    why: "Why",
    none: "They came with no invite. If a friend sent them and they booked another way, attach the friend's invite here.",
    form: {
      code: "Invite code",
      codeHint: "The letters and digits after maneman.in/r/ in the friend's link.",
      reason: "Why",
      reasonHint: "What the client or their friend told you.",
      note: "The reason is kept with the invite; the attach is in the audit log under your name. The invite's own rules apply: never the code's own referrer, never a client who came with an invite already, and never one already fitted.",
      save: "Attach the invite",
      saving: "Attaching",
      errors: {
        unknown_invite: "No invite has that code. Check it with the client. Nothing was attached.",
        own_invite: "That is this client's own invite. Nothing was attached.",
        invalid_request: "Type the code as letters and digits, and say why. Nothing was attached.",
        not_found: "This client is no longer on our records. Nothing was attached.",
        offline: "You are offline. Connect, then try again.",
        unknown: "That did not go through. Nothing was attached.",
      } as Readonly<Record<string, string>>,
    },
    news: {
      attached: "Attached. The CRM is sent it too.",
      already_invited: "They came with this invite already, so nothing was attached.",
    },
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
  /*
   * PLACEHOLDER, all of it: no board draws the client's hair profile (docs/decisions/0106-a-clients-hair-profile.md).
   * The lists' words wait for the owner (docs/open-points.md, item 42); the codes are the API's.
   */
  profile: {
    title: "Hair profile",
    none: "No profile has been recorded for this client.",
    /** "21 Sep 2026 · Imran, at the consultation", as each version is headed. */
    version: (date: string, by: string) => `${date} · ${by}`,
    atVisit: (name: string, visit: string) => `${name}, at the ${visit.toLowerCase()}`,
    byOps: (staff: string) => `${staff}, a correction`,
    unnamed: "A technician",
    aVisit: "visit",
    fit: "Fit spec",
    history: "Health history",
    versions: "Every version",
    rows: {
      norwood_stage: "Norwood stage",
      head_circumference_cm: "Circumference, cm",
      front_to_nape_cm: "Front to nape, cm",
      ear_to_ear_cm: "Ear to ear, cm",
      temple_to_temple_cm: "Temple to temple, cm",
      base_width_in: "Base width, in",
      base_length_in: "Base length, in",
      colour: "Colour",
      grey_percent: "Grey, %",
      density_percent: "Density",
      wave: "Wave",
      hairline: "Hairline",
      product: "Product",
      attachment: "Tape or glue",
      remedies: "Remedies tried",
      transplant_year: "Transplant's year",
      skin_and_allergies: "Skin conditions and allergies",
    },
    stages: { I: "I", II: "II", III: "III", IV: "IV", V: "V", VI: "VI", VII: "VII" },
    colours: { "1": "#1", "1B": "#1B", "2": "#2", "3": "#3", "4": "#4", "5": "#5", "6": "#6", "7": "#7", "8": "#8" },
    densities: { 80: "80%", 100: "100%", 120: "120%", 140: "140%" },
    waves: { straight: "Straight", slight_wave: "Slight wave", wavy: "Wavy", curly: "Curly" },
    hairlines: { natural: "Natural", receded: "Receded", straight: "Straight", widows_peak: "Widow's peak" },
    attachments: { tape: "Tape", glue: "Glue", both: "Tape and glue" },
    remedies: {
      none: "None",
      minoxidil: "Minoxidil",
      finasteride: "Finasteride",
      transplant: "Transplant",
      other_systems: "Other hair systems",
      other: "Other",
    },
    correct: "Correct the profile",
    record: "Record a profile",
    formTitle: "Correct the hair profile",
    formNote: "Saved as a new version under your name. Every version before it is kept.",
    notRecorded: "Not recorded",
    product: "The first fit's tier",
    invalid: "Check this field.",
    refused: "Some fields were not accepted. Check the fields marked.",
    failed: "That did not go through. Nothing was saved.",
    moved:
      "Nothing was saved: the profile changed while you were correcting it. It is shown as it now stands; correct that.",
    save: "Save as a new version",
    saving: "Saving",
    cancel: "Cancel",
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
    /** The board's four columns. */
    columns: ["Purpose", "State", "Date", "Source"],
    purposes: {
      photos_own_record: "Photographs for the client record",
      photos_referral_cards: "Photographs on referral cards",
      photos_marketing: "Photographs in marketing",
      whatsapp_visits: "WhatsApp about visits",
      whatsapp_launches: "WhatsApp about launches",
    },
    states: { given: "Given", not_given: "Not given", withdrawn: "Withdrawn" },
    /**
     * PLACEHOLDER: where each consent was given (docs/decisions/0094-where-a-consent-was-given.md). The board writes
     * "App" and "Site"; these name the place, short enough for its column.
     */
    sources: {
      site_booking: "Site",
      site_waitlist: "Waitlist",
      referral_landing: "Invite",
      try_on: "Try-on",
      app_booking: "Booking",
      app_profile: "Profile",
      app_share_sheet: "Refer",
      technician: "Technician",
      erasure: "Erasure",
    },
    /**
     * PLACEHOLDER: a consent with no place kept: given before this release on a notice several places showed, written
     * by the Worker it replaced before it was deployed, or switched from a copy of the app loaded before it.
     */
    notRecorded: "Not recorded",
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
 * they are here (docs/open-points.md, item 60).
 */
export const noShows = {
  title: "No-shows",
  /**
   * Board D1's first card: the day's money, over the charges it was kept on.
   * The card carries no heading on the board and names no day, so both are
   * placeholders. Every figure is read from the payments and the charges
   * themselves (docs/decisions/0096-a-no-shows-charge-and-its-dispute.md).
   */
  money: {
    /** PLACEHOLDER: the board's card has no heading, and a panel needs a name to be read by. */
    title: "Today",
    /** The board's own three, in its order and its words. */
    figures: { collected: "Collected today", processing: "Refunds processing", charged: "Charges and no-shows" },
    /** Under "Refunds processing", which counts what has not gone back yet. */
    refunded: (amount: string) => `${amount} went back today`,
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
       * PLACEHOLDER: words where the amount stands on a no-show charged before a
       * charge recorded what it kept, so the line cannot be read as a nought
       * (ADR 0036, PR #89).
       */
      noAmount: "Amount not recorded",
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
    /**
     * The board writes "240 m · over 200 m fence", against the radius in force
     * when he checked in; a distance inside it is ours (PLACEHOLDER).
     */
    distance: (metres: number, radius: number) =>
      metres > radius
        ? `${String(metres)} m · over ${String(radius)} m fence`
        : `${String(metres)} m · inside ${String(radius)} m fence`,
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
     * dispute, on its own card above the queue. A case is charged or waived.
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
     * PLACEHOLDER: the board draws no note beneath the queue, and no amount anywhere. A charge costs what the booking
     * was sold to cost a no-show, set in Settings apart from a late cancel (ADR 0096); a waiver gives back what ops set
     * it to, which the owner ruled on 27 September 2026 is the payment and the credit (BIZ-28; ADR 0088).
     */
    note: (waiver: { readonly payment: "refunded" | "kept"; readonly credit: "returned" | "spent" }) =>
      "Charging costs the client what their booking says a no-show costs, and gives back the rest. Waiving records " +
      "the decision, " +
      `${waiver.payment === "refunded" ? "refunds what the visit was paid with" : "keeps what the visit was paid with"} ` +
      `and ${waiver.credit === "returned" ? "returns its credit" : "leaves its credit spent"}. ` +
      "Either way the client is told on WhatsApp, never your note.",
    /** PLACEHOLDER: the board draws no empty queue. */
    empty: "No no-show is waiting for a decision.",
    errors: {
      not_found: "Someone has ruled on this one already. Reload to see the queue as it stands.",
      offline: "You are offline. Connect, then try again.",
      unknown: "That did not go through. Please try again.",
    } as Readonly<Record<string, string>>,
  },
  /**
   * Board D1's second card, a disputed charge, one card a dispute. The board
   * draws its label, its four rows of evidence, its note and its two buttons; the
   * rest is placeholder (docs/decisions/0096-a-no-shows-charge-and-its-dispute.md).
   */
  dispute: {
    /** The board's own label. */
    label: "Disputed charge",
    /**
     * PLACEHOLDER: the board heads the card "Vikram Sethi says he was home", its
     * summary of the client's words. Their words stand beneath, as they wrote them.
     */
    title: (name: string) => `${name} disputes the charge`,
    erased: "A client since erased disputes the charge",
    /** PLACEHOLDER: the client's words, erased with them. */
    wordsErased: "Their words were erased with them.",
    /** PLACEHOLDER: what the charge took, and when the visit was. */
    took: (what: string, day: string) => `The charge kept ${what}, for the visit of ${day}.`,
    credit: "a visit credit",
    /** The board's four rows. */
    facts: { checkIn: "Check-in", distance: "Distance", whatsapp: "WhatsApp", waited: "Waited" },
    /** PLACEHOLDER: no receipt came back for the reminder or the arrival notice. */
    notDelivered: "Not delivered",
    /** The board's note, "Your note · required", and its placeholder. */
    reason: {
      label: "Your note · required",
      placeholder: "Why you are refunding or upholding",
      hint: "Kept with the ruling, under your name. The client is told the ruling, never your note.",
    },
    refund: "Refund",
    uphold: "Uphold",
    ruling: "Ruling",
    /** PLACEHOLDER: the board always draws one. */
    none: "No charge is disputed.",
    errors: {
      not_found: "Someone has ruled on this dispute already. Reload to see where it stands.",
      offline: "You are offline. Connect, then try again.",
      unknown: "That did not go through. Please try again.",
    } as Readonly<Record<string, string>>,
  },
} as const;

/**
 * Board D2's queue. A task is not a record: it is a row in a queue the database
 * already keeps, read when ops look (src/policy/tasks.ts). The board draws four
 * groups, of which two have something behind them; the others here are queues
 * it does not draw (docs/open-points.md, item 61).
 */
export const tasks = {
  title: "Tasks",
  /** The head's count, in oxblood, as the board writes "4 overdue". */
  overdue: (count: number) => `${String(count)} overdue`,
  /** Each group, lettered in small caps as the board letters its own two. */
  groups: {
    // PLACEHOLDER: a group the board does not draw (docs/decisions/0069-dispatch-under-concurrency.md).
    untold_move: "Call about a move",
    // PLACEHOLDER: a group the board does not draw (docs/decisions/0095-a-booking-fsm-refuses-is-held.md).
    held_booking: "Booking not in FSM",
    // PLACEHOLDER: two groups the board does not draw (docs/decisions/0074-hand-offs-and-messages.md).
    leave_conflict: "Job on a day off",
    address_to_confirm: "Address to confirm",
    consultation_request: "Consultation request",
    // PLACEHOLDER: a group the board does not draw (docs/decisions/0086-the-next-visit-is-offered.md).
    first_fit_to_book: "First fit to book",
    replacement_order: "Replacement order",
    at_risk_client: "At-risk client",
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
    // PLACEHOLDER: a group the board does not draw (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md).
    payment_owed: "Payment owed",
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
    /**
     * PLACEHOLDER: "Service visit, Thu 24 Sep, afternoon; FSM refused it": booked or refunded from the client's
     * Visits tab (docs/decisions/0095-a-booking-fsm-refuses-is-held.md).
     */
    held_booking: (visit: string, day: string, window: string) => `${visit}, ${day}, ${window}; FSM refused it`,
    /** PLACEHOLDER: "Wed 23 Sep, 10:30 am, and Sameer is away": move it on the dispatch board, or take the leave back. */
    leave_conflict: (when: string, technician: string) => `${when}, and ${technician} is away`,
    /**
     * PLACEHOLDER: "Visit Tue 22 Sep, 10 am; no address yet". The client saves one in the app, whose Home asks for it,
     * or gives it to ops on the phone, who record it on their page; the task goes when either does (ADR 0092).
     */
    address_to_confirm: (when: string) => `Visit ${when}; no address yet`,
    /** "Asked for 23 Sep 2026, morning": the day nobody could book for them, self-serve booking being off. */
    consultation_request: (day: string, when: string) => `Asked for ${day}, ${when}`,
    /**
     * PLACEHOLDER: "+ consultation and fit in one visit", after the day and window asked for: book the client's first
     * fit in FSM for three hours, paid for at the visit (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md).
     */
    withOneVisit: "+ consultation and fit in one visit",
    /**
     * PLACEHOLDER: ", code WEDDNG25", after the one visit: the discount code the client gave on the form, which ops
     * enter on the visit once they have booked it (docs/decisions/0108-discount-codes.md).
     */
    withCode: (code: string) => `, code ${code}`,
    /**
     * PLACEHOLDER: "+ first fit, afternoon", after the consultation asked for: the site's form asked for the fit
     * too, which the client books and pays for in the app once the consultation is done (ADR 0086).
     */
    withFirstFit: (when: string | null) => (when === null ? "+ first fit" : `+ first fit, ${when.toLowerCase()}`),
    /**
     * PLACEHOLDER: "Consultation Thu 10 Sep; first fit asked for in the morning". Nothing is booked since the
     * consultation, and the task goes when the client books.
     */
    first_fit_to_book: (consulted: string, when: string | null) =>
      when === null
        ? `Consultation ${consulted}; first fit asked for`
        : `Consultation ${consulted}; first fit asked for in the ${when.toLowerCase()}`,
    /**
     * "9 weeks since the last visit · due Sat 19 Sep", as board D2 writes "9 weeks since service": the day the next
     * service fell due, from the cadence ops set. The task goes when the client books.
     */
    at_risk_client: (weeks: number, due: string) =>
      `${String(weeks)} ${weeks === 1 ? "week" : "weeks"} since the last visit · due ${due}`,
    /** "MM-STD-4417-C · due 1 Mar 2028". The board writes the supplier's lead time too; nothing records one. */
    replacement_order: (piece: string, due: string) => `${piece} · due ${due}`,
    /**
     * PLACEHOLDER: "The piece was not ready · 20 Sep": book the visit that finishes it. The reason is in the
     * words the job sheet gives it, which ops set in Settings (docs/decisions/0087-consumables-and-stock.md).
     */
    partial_visit: (reason: string, date: string) => `${reason} · ${date}`,
    /** PLACEHOLDER: a visit closed partial in FSM's own screen, with no reason from the technician. */
    noReason: "No reason recorded",
    no_show_decision: (technician: string) => `${technician} attended`,
    number_change: "Both numbers proven by code",
    erasure_request: "Asked for in the client's own app",
    // PLACEHOLDER: a concern about their data, which the app promises an answer to within 30 days.
    grievance: "Raised in the client's own app",
    // PLACEHOLDER: the client cannot open the invoice until somebody sends it in Books.
    draft_invoice: (visit: string) => `Visit of ${visit}, still a draft in Books`,
    /**
     * PLACEHOLDER: "Mane Man Natural, Rs. 45,000; link sent": a one visit's client was fitted and has not paid. A
     * link not sent waits for ops to send one from Razorpay's dashboard (ADR 0105).
     */
    payment_owed: (product: string, amount: string, sent: boolean) =>
      `${product}, ${amount}; ${sent ? "link sent" : "link not sent"}`,
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
  /**
   * Whose each task is (docs/decisions/0092-task-owners.md). The board writes each owner in ops by their first name,
   * "Priya", in its own column; PLACEHOLDER: it draws no way to take a task, give it to someone or hand it back.
   */
  owner: {
    /** For a screen reader, before the column's name: "Owner: Priya". */
    label: "Owner: ",
    nobody: "nobody yet",
    take: "Take it",
    handBack: "Hand it back",
    give: "Give it to…",
    giveTo: "Give it to",
    /** The choice in the list that hands someone else's task back. */
    giveNobody: "Nobody",
    you: (email: string) => `${email} (you)`,
    save: "Give it",
    saving: "Saving…",
    cancel: "Cancel",
    errors: {
      not_found: "This task has left the list meanwhile: its thing was done. Reload the page to see the list now.",
      invalid_request: "Nobody has used the console lately with that e-mail, so the task cannot be theirs.",
      unknown: "That did not save. Try again.",
    } as Readonly<Record<string, string>>,
  },
  /**
   * PLACEHOLDER: a visit left partly done closed without a follow-up, with why, as the owner ruled
   * (docs/decisions/0092-task-owners.md). No board draws it.
   */
  close: {
    open: "Close without a follow-up",
    label: "Why no visit is booked to finish it",
    hint: "Required. Kept with the visit, under your name, and shown on the client's page.",
    confirm: "Close it",
    closing: "Closing…",
    cancel: "Cancel",
    errors: {
      not_found: "This task has left the list meanwhile: a visit was booked, or it was closed. Reload the page.",
      invalid_request: "Say why no visit is booked, in a sentence or two.",
      unknown: "That did not close. Try again.",
    } as Readonly<Record<string, string>>,
  },
  /** PLACEHOLDER: the board draws no note, and the list has to say where the work is done. */
  note:
    "A task leaves this list when the thing itself is decided, where it is decided. A visit left partly done may " +
    "also be closed here, with why.",
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
     * still to confirm (docs/open-points.md, item 51).
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
  /**
   * PLACEHOLDER: no board draws the storage meter's line (docs/decisions/0093-the-storage-meter.md). Gigabytes as
   * Cloudflare bills them, a thousand million bytes.
   */
  storage: (held: number, share: number) =>
    `Photographs and referral cards hold ${(held / 1e9).toFixed(2)} GB in R2, ${String(Math.round((held / share) * 100))}% ` +
    `of their ${String(share / 1e9)} GB share. Past it R2 bills, as the owner accepted; ops are told at 50%, 80% and 100%.`,
  // PLACEHOLDER: the prices tab holds the services too (docs/decisions/0085-services-ops-can-edit.md), and no board
  // draws the last three tabs' names (docs/decisions/0087-consumables-and-stock.md,
  // docs/decisions/0088-every-policy-in-the-console.md).
  tabs: {
    rules: "Rules",
    prices: "Services and prices",
    "discount-codes": "Discount codes",
    area: "Service area",
    blackouts: "Blackout days",
    consumables: "Consumables",
    "job-sheet": "Job sheet",
    staff: "Staff",
  },
  /**
   * PLACEHOLDER, every line of it: no board draws discount codes (docs/decisions/0108-discount-codes.md).
   * What a code takes off is shown before it is made, as a price is set
   * (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).
   */
  discountCodes: {
    title: "Discount codes",
    note:
      "A code takes money off a first fit, a service visit or a replacement, before GST. The client enters it where " +
      "they pay or book, the technician before sending a payment link, ops on a visit. It is never taken on a visit " +
      "a referral credit pays for, and once a visit is paid for or invoiced its code stays as it is.",
    make: "Make codes",
    how: "The code",
    typed: "Type one",
    generated: "Generate them",
    code: "Code",
    codeHint: "4 to 16 letters and figures. Not I, L, O, 0 or 1, which read as each other.",
    count: "How many",
    countHint: (most: number) => `1 to ${String(most)}. More than one makes each a single-use code.`,
    takesOff: "Takes off",
    percent: "A percentage",
    amount: "An amount",
    value: "Per cent",
    rupeesOff: "Rupees",
    cap: "At most, in rupees",
    capHint: "Optional. Leave empty for no cap.",
    covers: "Covers",
    coverNames: {
      first_fit: "First fit, and the consultation and fit in one visit",
      service: "Service visits",
      replacement: "Replacements",
    } as Readonly<Record<string, string>>,
    expires: "Last day it may be used",
    expiresHint: "Optional. Leave empty for no end.",
    maxUses: "Total uses",
    maxUsesHint: "Optional. Leave empty for no limit.",
    oncePerClient: "Once per client",
    check: "Check",
    checkTitle: "Make these codes?",
    send: "Make them",
    sending: "Making",
    back: "Back",
    /** One line of the check: what each code takes off. */
    off: (what: string) => `Takes off ${what} before GST`,
    percentOff: (percent: number, cap: string | null) =>
      cap === null ? `${String(percent)}%` : `${String(percent)}%, at most ${cap}`,
    covering: (kinds: string) => `On ${kinds}`,
    until: (day: string | null) => (day === null ? "No end" : `Until ${day}, the last day`),
    usesLine: (uses: number | null, once: boolean) =>
      `${uses === null ? "Any number of uses" : `${String(uses)} ${uses === 1 ? "use" : "uses"} in all`}${once ? ", once per client" : ""}`,
    oneTyped: (code: string) => `The code ${code}`,
    manyGenerated: (count: number) => `${String(count)} codes, generated, each used once`,
    oneGenerated: "One code, generated",
    made: (codes: readonly string[]) => `Made: ${codes.join(", ")}`,
    find: "Find a code",
    findButton: "Find",
    showAll: "Show the latest",
    none: "No code yet.",
    noneFound: "No code has that text.",
    /** How far a code is used: "3 of 10 uses", or "3 uses" with no limit. */
    usesOf: (uses: number, most: number | null) =>
      most === null ? `${String(uses)} ${uses === 1 ? "use" : "uses"}` : `${String(uses)} of ${String(most)} uses`,
    given: (amount: string) => `${amount} given`,
    madeBy: (who: string, when: string) => `Made by ${who} on ${when}`,
    switchedOffBy: (who: string, when: string) => `Switched off by ${who} on ${when}`,
    switchOff: "Switch off",
    switchOffLabel: (code: string) => `Switch off ${code}`,
    switchTitle: (code: string) => `Switch off ${code}?`,
    switchLine: (uses: number) =>
      `No booking takes it from now on. ${String(uses)} ${uses === 1 ? "booking keeps" : "bookings keep"} it, as sold.`,
    switching: "Switching off",
    errors: {
      code: "A code is 4 to 16 letters and figures, none of them I, L, O, 0 or 1.",
      count: "A code you type is made once. Generate them to make more.",
      value: "A percentage is 1 to 100.",
      cap: "Only a percentage takes a cap.",
      covers: "Choose what the code covers.",
      expires_on: "The last day cannot be before today.",
      max_uses: "Generated codes are single-use: one use each.",
      code_exists: "A code with that text exists already.",
      not_found: "That code is gone. Reload to see the list as it stands.",
      offline: "You are offline. Connect, then try again.",
      unknown: "That did not go through. Nothing was changed.",
    } as Readonly<Record<string, string>>,
  },
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
      late_change_charge: dispatch.typeNames,
      no_show_charge: dispatch.typeNames,
      // PLACEHOLDER: what a waiver gives back (docs/decisions/0088-every-policy-in-the-console.md).
      no_show_waiver: { payment: "The visit's payment", credit: "The visit credit it used" },
      task_sla_hours: tasks.groups,
      // PLACEHOLDER: the phone's two bounds (docs/decisions/0088-every-policy-in-the-console.md).
      phone_clock: {
        before_start: "Earliest check-in, before the booked start",
        held_offline: "Longest a phone may hold what was done offline",
      },
      // PLACEHOLDER: board C4's countdown and the grace after it (docs/decisions/0068-a-paid-hold-is-kept.md).
      payment_hold: {
        countdown: "The countdown the client sees",
        grace: "A payment still in time, after it",
      },
      // PLACEHOLDER: how often, and how long, a booking FSM refused is tried again (ADR 0095).
      fsm_retry: {
        every: "Tried again every",
        for: "For, from the fifth refusal",
      },
      // PLACEHOLDER: board D3's two figures (docs/open-points.md, item 59).
      technician_work: {
        period: "Jobs and average service, counted over",
        over_by: "Shown as running over, from",
      },
      // PLACEHOLDER: the days the next visit turns on (docs/decisions/0086-the-next-visit-is-offered.md).
      booking_days: {
        first_fit_lead: "From a consultation to the first fit",
        service_cadence: "Between service visits",
        reminder_before_due: "Reminder, before the next service is due",
        at_risk_after_due: "At-risk client, after it was due",
        first_fit_to_book: "First fit to book, after the consultation",
        horizon: "How far ahead a visit may be booked",
        invoice_prompt: "A new invoice on Home",
      },
      // PLACEHOLDER: what a referral earns, each side apart (docs/decisions/0107-referral-rewards-in-the-console.md).
      referral_reward: {
        referrer_visits: "The client who sent the invite",
        friend_visits: "The friend they invited",
        valid_days: "The credits last",
      },
    } as Readonly<Record<string, Readonly<Record<string, string>>>>,
    /**
     * PLACEHOLDER: each choice a rule of choices offers, in the console's words, by the rule's name
     * (docs/decisions/0088-every-policy-in-the-console.md).
     */
    choiceNames: {
      late_change_charge: { nothing: "Nothing", late_fee: "Its late fee", visit: "The visit itself" },
      no_show_charge: { nothing: "Nothing", late_fee: "Its late fee", visit: "The visit itself" },
      no_show_waiver: { refunded: "Refunded", kept: "Kept", returned: "Returned", spent: "Spent" },
    } as Readonly<Record<string, Readonly<Record<string, string>>>>,
    /**
     * PLACEHOLDER: the check before a rule is sent, as a price's (docs/decisions/0071-what-ops-see-before-a-setting-
     * changes.md): each figure that moves, the old beside the new.
     */
    confirm: {
      title: "Check the change",
      change: (label: string, was: string, now: string) => `${label}: ${was} → ${now}.`,
      /** A figure as the check writes it: "200 metres". */
      figure: (value: number, unit: string) => `${String(value)} ${unit}`,
      /** A base ops are naming for the first time had no figure of its own. */
      noFigure: "none",
      /** A base whose own figure is taken away takes the one for every other base. */
      otherBases: "the figure for every other base",
      standard: "This puts the standard figures back.",
      send: "Save",
      back: "Change it",
    },
    /** The rule's name, or one of its boxes, and what the API said of it. */
    outside: (field: string) => `${field} is outside what this rule allows. Nothing was changed.`,
    errors: {
      invalid_request: "That figure is outside what this rule allows. Nothing was changed.",
      offline: "You are offline. Connect, then try again.",
      unknown: "That did not go through. Nothing was changed.",
    } as Readonly<Record<string, string>>,
  },
  /**
   * PLACEHOLDER, every line of it: no board draws the days no visit is offered, which the runbook's SQL set before
   * (docs/decisions/0088-every-policy-in-the-console.md).
   */
  blackouts: {
    title: "Blackout days",
    note:
      "Days no visit is offered, in the app or from the site. Blacking out a day moves no visit already booked on " +
      "it: move those on the dispatch board.",
    from: "First day",
    to: "Last day",
    reason: "Why",
    add: "Black out these days",
    adding: "Adding",
    added: "Added.",
    none: "No day is blacked out.",
    /** "Tue 20 Oct to Thu 22 Oct", and "Tue 20 Oct" for one day. */
    period: (from: string, to: string) => (from === to ? from : `${from} to ${to}`),
    setBy: (who: string, when: string) => `Added by ${who} on ${when}`,
    unrecorded: "Added before this screen, so who added it is not recorded.",
    booked: (visits: number) =>
      `${String(visits)} ${visits === 1 ? "visit is" : "visits are"} still booked on these days. Move ${
        visits === 1 ? "it" : "them"
      } on the dispatch board.`,
    remove: "Offer these days again",
    /** The button's whole name, since the list holds many and each button says the same. */
    removeLabel: (period: string) => `Offer ${period} again`,
    removing: "Offering them again",
    errors: {
      from: "The first day cannot be before today.",
      to: "The last day cannot come before the first, and one go covers a month at most.",
      reason: "Say why, in letters and figures, up to 60 of them.",
      not_found: "Those days are no longer blacked out. Reload to see the list as it stands.",
      offline: "You are offline. Connect, then try again.",
      unknown: "That did not go through. Nothing was changed.",
    } as Readonly<Record<string, string>>,
  },
  /**
   * PLACEHOLDER, every line of it: no board draws the services (docs/decisions/0085-services-ops-can-edit.md). A kind
   * of visit is code; the services within it are ops', each named, timed, priced, ordered and retired from a day
   * here, and FSM's catalogue follows each by its own item. What a price or a change was is shown beside what it will
   * be before anything is sent (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).
   */
  services: {
    title: "Services and prices",
    note:
      "What clients can book, kind by kind. A price applies from the day you give it and never before, so nothing " +
      "already sold moves. Each service reaches FSM's catalogue as its own item.",
    /** The four kinds, as the rest of the console names them. */
    kinds: dispatch.typeNames,
    /** "180 minutes · code premium": how long it is held and booked for, and what the price book prices it by. */
    facts: (minutes: number, tier: string) => `${String(minutes)} minutes · code ${tier}`,
    fsm: { linked: "In FSM's catalogue", notYet: "Not found in FSM's catalogue yet" },
    offered: "Offered",
    retiring: (from: string) => `Clients stop seeing it from ${from}`,
    retired: (from: string) => `Retired from ${from}`,
    /** Under a service, what it costs today, and what it will from a later day. */
    now: (price: string, since: string) => `Now ${price}, since ${since}.`,
    unpriced: "No price yet, so clients do not see it.",
    toCome: (price: string, from: string) => `${price} from ${from}`,
    /** "Rs. 2,000 + 18% GST": a price as the check compares two. */
    price: (rupees: string, gst: number) => `${rupees} + ${String(gst)}% GST`,
    history: (count: number) => (count === 1 ? "1 earlier price" : `${String(count)} earlier prices`),
    historyCaption: (name: string) => `Earlier prices of ${name}`,
    historyColumns: ["Before GST", "GST", "From"],
    percent: (value: number) => `${String(value)}%`,
    /** The two late fees, each one figure for its kind, beside its kind's services. */
    lateFees: {
      late_fee_first_fit: "Late fee on a first fit",
      late_fee_replacement: "Late fee on a replacement",
    } as Readonly<Record<string, string>>,
    lateFeeNote:
      "Charged for moving or cancelling inside the notice set in Rules, where Rules charge the kind its late fee, " +
      "whichever of its services it is.",
    actions: {
      price: "Change price",
      correct: "Correct",
      takeBack: "Take back",
      rename: "Rename",
      length: "Change length",
      retire: "Retire",
      restore: "Restore",
      up: "Move up",
      down: "Move down",
      add: (kind: string) => `Add a service to ${kind}`,
    },
    /** Each button named for a screen reader with what it acts on. */
    labels: {
      price: (name: string) => `Change the price of ${name}`,
      correct: (name: string, from: string) => `Correct the ${name} price from ${from}`,
      takeBack: (name: string, from: string) => `Take back the ${name} price from ${from}`,
      rename: (name: string) => `Rename ${name}`,
      length: (name: string) => `Change the length of ${name}`,
      retire: (name: string) => `Retire ${name}`,
      restore: (name: string) => `Restore ${name}`,
      up: (name: string) => `Move ${name} up`,
      down: (name: string) => `Move ${name} down`,
    },
    form: {
      priceTitle: (name: string) => `A new price for ${name}`,
      correctTitle: (name: string, from: string) => `Correct the ${name} price from ${from}`,
      amount: "Price before GST, in rupees",
      amountHint: (max: string) => `Whole rupees, up to ${max}.`,
      gst: "GST",
      gstHint: (max: number) => `A whole percentage, 0 to ${String(max)}.`,
      from: "Applies from",
      fromHint: "Today or a day after it.",
      setPrice: "Set this price",
      renameTitle: (name: string) => `Rename ${name}`,
      name: "Name",
      nameHint: "What clients, ops and FSM's catalogue call it. A letter or a digit first.",
      lengthTitle: (name: string) => `The length of ${name}`,
      minutes: "Length, in minutes",
      minutesHint: (min: number, max: number) =>
        `Whole minutes, ${String(min)} to ${String(max)}. The day keeps this long for each visit.`,
      retireTitle: (name: string) => `Retire ${name}`,
      retireFrom: "Clients stop seeing it from",
      retireHint: "Today or a day after it. Visits already sold stay as they were sold.",
      addTitle: (kind: string) => `A new service of ${kind}`,
      code: "Code",
      codeHint: "The price book prices the service by it, and it never changes. Made from the name.",
      next: "Check the change",
      cancel: "Cancel",
    },
    /** The check before anything is sent: what it is now, and what it will be. */
    check: {
      title: "Check the change",
      price: (name: string, was: string, now: string, from: string) => `${name}: ${was} → ${now}, from ${from}.`,
      correct: (name: string, was: string, wasFrom: string, now: string, from: string) =>
        `${name}: ${was} from ${wasFrom} → ${now} from ${from}.`,
      nothing: "nothing",
      gstChanges: (was: number, now: number) => `GST changes from ${String(was)}% to ${String(now)}%.`,
      sameDay: "A price is already set from that day. This replaces it.",
      rename: (was: string, now: string, tier: string) =>
        `${was} → ${now}. Its code stays ${tier}, and with it every price it has and every visit sold.`,
      length: (name: string, was: number, now: number) =>
        `${name}: ${String(was)} → ${String(now)} minutes. A visit held or booked before keeps its own length.`,
      retire: (name: string, from: string) =>
        `Clients stop seeing ${name} from ${from}. Visits already sold stay as they were sold.`,
      restore: (name: string) => `Offer ${name} again. Its prices are as they were.`,
      order: (kind: string, was: string, now: string) => `${kind}: ${was} → ${now}.`,
      add: (kind: string, name: string, minutes: number, tier: string) =>
        `Add ${name} to ${kind}: ${String(minutes)} minutes, code ${tier}. Clients see it once it has a price.`,
      takeBack: (from: string) => `Take back the price from ${from}? The price before it goes on applying.`,
      send: "Save it",
      back: "Change it",
      takeBackConfirm: "Take it back",
      keep: "Keep it",
    },
    saving: "Saving",
    done: {
      price: "The price is set.",
      takenBack: "The price is taken back.",
      saved: "Saved.",
    },
    /** A refusal names the box it came from (src/routes/ops-services.ts, ops-settings.ts); these are said of each. */
    errors: {
      tier: "No service of this kind has that code, or a code cannot be made from that name. Nothing was changed.",
      name: "A name starts with a letter or a digit, runs from 2 to 60 characters, and opens no formula. Nothing was changed.",
      minutes: "A length is whole minutes, inside the range under the field. Nothing was changed.",
      retired_date:
        "A service retires from today or a day after it, and one already retired is restored first. Nothing was changed.",
      order: "The order has changed since the page was read. Reload to see it as it stands.",
      amount_ex_gst: "A price is in whole rupees, inside the range under the field. Nothing was changed.",
      gst_percent: "GST is a whole percentage, inside the range under the field. Nothing was changed.",
      valid_from: "A price applies from today or a day after it. Nothing was changed.",
      was_valid_from: "That price applies already, so it stays in the book.",
      service_exists: "Another service already has that name, or this kind that code. Nothing was changed.",
      last_of_kind:
        "Each kind keeps one service that is never retired and has a price, so clients can always book it. Add and " +
        "price the one that replaces it first.",
      service_retired: "The service is retired by that day, so it takes no price from then. Nothing was changed.",
      not_found: "That is no longer in the console. Reload to see it as it stands.",
      offline: "You are offline. Connect, then try again.",
      unknown: "That did not go through. Nothing was changed.",
    } as Readonly<Record<string, string>>,
    /** Taking back a price that applies already, or has applied: it may stand on an invoice. */
    takeBackErrors: {
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
  /**
   * PLACEHOLDER: every word of the consumables and of each service's expected
   * use. No board draws them; the owner ruled on 27 September 2026 that both
   * are set here (docs/decisions/0087-consumables-and-stock.md).
   */
  consumables: {
    title: "Consumables",
    // PLACEHOLDER
    note: "What a technician may record using on a job, and what one costs us. The cost is ours alone: no client's invoice carries it.",
    /** PLACEHOLDER: whether FSM's catalogue follows by itself (FSM_CATALOGUE_PUSH). */
    fsmNote: {
      on: "FSM's catalogue follows within the hour: a new consumable is added there as a part at Rs. 0, and a rename renames it.",
      off: "FSM's catalogue does not follow by itself yet. Add each consumable in FSM as a part at Rs. 0, named exactly as here; the hourly check then finds it by its name.",
    },
    // PLACEHOLDER
    columns: ["Consumable", "Cost of one", "Low at", "In FSM", "State"],
    none: "No consumables yet. Add the first below.",
    /** PLACEHOLDER: "Kit 5 · store 50", the levels a place is low at. */
    levels: (kit: number | null, central: number | null) => {
      if (kit === null && central === null) return "No level";
      const parts = [kit === null ? null : `Kit ${String(kit)}`, central === null ? null : `store ${String(central)}`];
      return parts.filter((part) => part !== null).join(" · ");
    },
    /** PLACEHOLDER: where each stands in FSM's catalogue, as the hourly check last read it. */
    fsm: {
      linked: "In FSM",
      renamed: (name: string) => `In FSM as ${name}`,
      missing: "Not in FSM",
      unchecked: "Not checked yet",
    },
    // PLACEHOLDER
    states: {
      offered: "Offered",
      retiring: (from: string) => `Offered until ${from}`,
      retired: (from: string) => `Retired from ${from}`,
    },
    // PLACEHOLDER: the buttons in each row, named for the screen reader by the consumable.
    change: "Change",
    changeLabel: (name: string) => `Change ${name}`,
    retire: "Retire",
    retireLabel: (name: string) => `Retire ${name}`,
    restore: "Restore",
    restoreLabel: (name: string) => `Restore ${name}`,
    form: {
      // PLACEHOLDER
      addTitle: "Add a consumable",
      changeTitle: (name: string) => `Change ${name}`,
      name: "Name",
      nameHint: "As the technician reads it and FSM's catalogue names it: a letter or a digit first.",
      unit: "Unit",
      unitHint: "What one is counted in: strip, ml, sachet.",
      cost: "Cost of one, in rupees",
      costHint: (max: string) => `Up to ${max}, to the paisa. Ours alone: no invoice carries it.`,
      kit: "A kit is low at",
      central: "The central store is low at",
      levelHint: "In its unit. Leave it empty for no alert.",
      add: "Add this consumable",
      save: "Save the change",
      saving: "Saving",
      cancel: "Not now",
      added: "The consumable is added. The technician app offers it from now.",
      saved: "The change is saved.",
      /** PLACEHOLDER: the check before anything is sent, the old beside the new. */
      confirm: {
        title: "Check the change",
        adding: (name: string, unit: string, cost: string) => `${name}, counted in ${unit}, at ${cost} each.`,
        line: (field: string, was: string, now: string) => `${field}: ${was} → ${now}`,
        fields: { name: "Name", unit: "Unit", cost: "Cost of one", kit: "Kit low at", central: "Store low at" },
        noLevel: "no level",
        renamed: "FSM's part keeps its old name until the push renames it, or you rename it there.",
        send: "Save it",
        back: "Change it",
        nothing: "Nothing has changed.",
      },
    },
    retiring: {
      // PLACEHOLDER
      title: (name: string) => `Retire ${name}`,
      from: "No longer offered from",
      fromHint: "Today or a day after it. What was recorded stays, and so does its stock.",
      question: (name: string, from: string) =>
        `The technician app stops offering ${name} from ${from}. A job that already recorded it keeps it.`,
      send: "Retire it",
      restore: (name: string) => `Offer ${name} to the technician app again?`,
      restoreSend: "Restore it",
      done: "Done.",
    },
    usage: {
      // PLACEHOLDER
      title: "What each service uses",
      note: "The technician's steppers start at these on a job of the service. He can change them, and add any other consumable.",
      service: "Service",
      /** A service by its name, as the console names it; "Lace replacement, retired from 1 Oct 2027" once retired. */
      serviceName: (name: string, retiredFrom: string | null) =>
        retiredFrom === null ? name : `${name}, retired from ${retiredFrom}`,
      quantity: (name: string, unit: string) => `${name}, ${unit} a visit`,
      quantityHint: (max: number) => `A whole number up to ${String(max)}. Leave it empty if the service uses none.`,
      noneOffered: "Add a consumable above before setting what a service uses.",
      save: "Save this service's use",
      confirm: {
        title: "Check the change",
        line: (name: string, was: string, now: string) => `${name}: ${was} → ${now}`,
        none: "none",
        send: "Save it",
        back: "Change it",
        nothing: "Nothing has changed.",
      },
      saved: "Saved. The technician app reads it with the next job it opens.",
    },
    /** PLACEHOLDER: a refusal, said of the box it names (src/routes/ops-consumables.ts). */
    errors: {
      name: "Another consumable has that name, or it does not start with a letter or a digit. Nothing was changed.",
      unit: "A unit is a word of letters: strip, ml, sachet. Nothing was changed.",
      unit_cost: "The cost is in rupees, inside the range under the field. Nothing was changed.",
      reorder_kit: "A level is a whole number, or empty. Nothing was changed.",
      reorder_central: "A level is a whole number, or empty. Nothing was changed.",
      from: "A consumable is retired from today or a day after it. Nothing was changed.",
      tier: "The console no longer holds that service. Nothing was changed.",
      items: "That names a consumable nobody added, or one twice. Nothing was changed.",
      not_found: "That consumable is not in the list any more. Reload the page.",
      offline: "You are offline. Connect, then try again.",
      unknown: "That did not go through. Nothing was changed.",
    } as Readonly<Record<string, string>>,
  },
  /**
   * PLACEHOLDER: every word of the job sheet the technician app reads: each
   * kind of visit's checklist and the partial reasons (docs/open-points.md,
   * item 28). No board draws it.
   */
  jobSheet: {
    title: "Job sheet",
    // PLACEHOLDER
    note: "What the technician ticks on each kind of visit, and the reasons he may pick when a job is left partly done. His phone reads them with each job it opens; a job already on it keeps the list it was given.",
    kind: "Kind of visit",
    checklist: (type: string) => `${type} checklist`,
    reasons: "Partial reasons",
    reasonsNote: "These drive the Tasks board: a job left partly done waits there with its reason.",
    item: (position: number) => `Item ${String(position)}`,
    reason: (position: number) => `Reason ${String(position)}`,
    /** The buttons beside an item: each names the item after what it does, so a screen reader says which. */
    upButton: "Move up",
    up: (label: string) => `Move up: ${label}`,
    downButton: "Move down",
    down: (label: string) => `Move down: ${label}`,
    removeButton: "Take off",
    remove: (label: string) => `Take off: ${label}`,
    unnamed: "the empty item",
    add: "Add an item",
    addReason: "Add a reason",
    retired: "Taken off",
    retiredNote: "A phone that recorded one of these before it was taken off is still understood.",
    putBack: (label: string) => `Put back: ${label}`,
    putBackButton: "Put back",
    committed: "Nobody has set this, so the standard list stands.",
    setBy: (who: string, when: string) => `Set by ${who} on ${when}`,
    hint: (most: number, longest: number) =>
      `At least one, at most ${String(most)}, each up to ${String(longest)} characters and no two alike.`,
    save: "Save this list",
    saving: "Saving",
    saved: "Saved. Each phone reads it with the next job it opens.",
    confirm: {
      title: "Check the change",
      was: "Was",
      now: "Now",
      added: (label: string) => `Added: ${label}`,
      renamed: (was: string, now: string) => `Renamed: ${was} → ${now}`,
      takenOff: (label: string) => `Taken off: ${label}`,
      moved: "The order changes.",
      send: "Save it",
      back: "Change it",
      nothing: "Nothing has changed.",
    },
    errors: {
      items: "A list holds at least one item and no more than the limit under it. Nothing was changed.",
      label: "Each item needs words, no longer than the limit, and no two alike. Nothing was changed.",
      offline: "You are offline. Connect, then try again.",
      unknown: "That did not go through. Nothing was changed.",
    } as Readonly<Record<string, string>>,
  },
  /**
   * PLACEHOLDER, every line of it: no board draws the Staff page. A change is shown before it is saved.
   */
  staff: {
    title: "Staff",
    note:
      "Who may use the console, and for what. Each grant gives one department at one level, nationally, across a " +
      "zone or in one city. View sees; Act does the day's work; Manage also refunds, waives, sets prices, codes and " +
      "settings, deletes accounts and grants access.",
    departments: {
      operations: "Operations",
      customer_care: "Customer Care",
      finance: "Finance",
      growth: "Growth",
      admin: "Admin",
    },
    levels: { view: "View", act: "Act", manage: "Manage" },
    national: "National",
    zone: (name: string) => `${name} zone`,
    zones: "Zones",
    cities: "Cities",
    grant: (department: string, level: string, place: string) => `${department} · ${level} · ${place}`,
    columns: { person: "Person", access: "Access", state: "Status" },
    noAccess: "No access yet",
    active: "Let in",
    inactive: "Switched off",
    add: "Add a person",
    change: "Change",
    changeLabel: (email: string) => `Change ${email}`,
    form: {
      addTitle: "Add a person",
      changeTitle: (email: string) => `Change ${email}`,
      email: "Sign-in e-mail",
      emailHint: "The address they sign in to the console with.",
      letIn: "Let them in",
      access: "Access",
      department: "Department",
      level: "Level",
      place: "Where",
      addGrant: "Add a department",
      removeGrant: "Remove",
      removeGrantLabel: (grant: string) => `Remove ${grant}`,
      review: "Review",
      cancel: "Cancel",
    },
    confirm: {
      title: "Check the change",
      adds: (email: string) => `Adds ${email}.`,
      letsIn: "Lets them in again.",
      switchesOff: "Switches them off: the console closes to them.",
      gives: (grant: string) => `Gives ${grant}`,
      takes: (grant: string) => `Takes away ${grant}`,
      nothing: "Nothing has changed.",
      send: "Save it",
      sending: "Saving",
      back: "Change it",
    },
    saved: "Saved.",
    errors: {
      email: "Enter the e-mail they sign in with.",
      place: "Choose where this access applies.",
      grants: "Give each department once for each place.",
      not_permitted: "You can grant access only within your own area, and only with Admin · Manage.",
      last_admin: "Someone must keep Admin · Manage nationally. Give it to another person first.",
      offline: "You are offline. Connect, then try again.",
      unknown: "That did not go through. Nothing was changed.",
    } as Readonly<Record<string, string>>,
    enforcement: {
      title: "Access control",
      off:
        "Not enforced yet. Everyone Access lets in can open every section, and each call this list would refuse is " +
        "logged. Check the list, then start enforcing.",
      on: "Enforced. People open only the departments and places granted here; anyone not listed sees nothing.",
      setBy: (who: string, when: string) => `Switched by ${who} on ${when}`,
      start: "Start enforcing",
      stop: "Stop enforcing",
      startTitle: "Start enforcing access?",
      startLine: "From now on, only the people listed here can use the console, and only as granted.",
      stopTitle: "Stop enforcing access?",
      stopLine: "Everyone Access lets in will open every section again.",
      sending: "Saving",
      back: "Go back",
      onlyNational: "Only someone with Admin · Manage nationally can switch this.",
      errors: {
        not_permitted: "Only someone with Admin · Manage nationally can switch this.",
        offline: "You are offline. Connect, then try again.",
        unknown: "That did not go through. Nothing was changed.",
      } as Readonly<Record<string, string>>,
    },
    tokens: {
      title: "Service tokens",
      note:
        "Automated access, such as the test runner's. A token listed here can do everything except grant access; " +
        "one not listed is refused once access is enforced.",
      none: "No service token is listed.",
      addedBy: (who: string, when: string) => `Added by ${who} on ${when}`,
      clientId: "Client ID",
      clientIdHint: "From Cloudflare Access, under Service credentials.",
      label: "Name",
      add: "Add the token",
      adding: "Adding",
      remove: "Remove",
      removeLabel: (label: string) => `Remove ${label}`,
      removeTitle: (label: string) => `Remove ${label}?`,
      removeLine: "Whatever uses it is refused once access is enforced.",
      removing: "Removing",
      back: "Keep it",
      onlyNational: "Only someone with Admin · Manage nationally can change service tokens.",
      errors: {
        client_id: "Paste the client ID exactly as Cloudflare Access shows it.",
        label: "Give it a short name.",
        not_found: "That token is no longer listed. Reload to see the list as it stands.",
        not_permitted: "Only someone with Admin · Manage nationally can change service tokens.",
        offline: "You are offline. Connect, then try again.",
        unknown: "That did not go through. Nothing was changed.",
      } as Readonly<Record<string, string>>,
    },
  },
} as const;

/**
 * PLACEHOLDER: every word of Stock, which no board draws. The owner ruled on
 * 27 September 2026 that stock is kept in our own ledger, per technician's
 * kit and a central store (docs/decisions/0087-consumables-and-stock.md).
 */
export const stock = {
  title: "Stock",
  // PLACEHOLDER
  sub: "What each kit and the central store hold. A job's use comes out of its technician's kit as he records it.",
  onHand: "On hand",
  central: "Central store",
  /** PLACEHOLDER: a technician who has left, whose kit still holds stock. */
  left: (name: string) => `${name} (left)`,
  consumable: "Consumable",
  /** PLACEHOLDER: "12 strip", and a mark for a place at or below its level. */
  held: (quantity: number, unit: string) => `${String(quantity)} ${unit}`,
  low: "Low",
  lowNote: "Low: at or below the level set for the consumable in Settings, Consumables.",
  retired: "retired",
  counted: (when: string) => `Counted ${when}`,
  none: "No consumables yet. Add them in Settings, Consumables.",
  record: {
    // PLACEHOLDER
    title: "Record a movement",
    what: "What happened",
    kinds: {
      delivery: "A delivery into the central store",
      transfer: "A transfer",
      count: "A count",
      write_off: "A loss",
    } as Readonly<Record<string, string>>,
    consumable: "Consumable",
    quantity: "How many",
    quantityHint: (unit: string, max: number) => `In ${unit}, a whole number up to ${String(max)}.`,
    from: "From",
    to: "To",
    place: "Where",
    counted: "How many were counted",
    note: "Note",
    noteHint: "The supplier's note, or what happened. No client's name.",
    lossNote: "What was lost, and how",
    check: "Check it",
  },
  confirm: {
    // PLACEHOLDER: what the movement does to each place, the old beside the new.
    title: "Check the movement",
    line: (place: string, was: string, now: string) => `${place}: ${was} → ${now}`,
    below: (place: string) =>
      `${place} would hold less than nothing: record the delivery or the count that is missing.`,
    same: "A count that agrees records only that it was counted.",
    send: "Record it",
    back: "Change it",
  },
  recorded: "Recorded.",
  movements: {
    // PLACEHOLDER
    title: "Latest movements",
    columns: ["When", "Consumable", "Where", "Change", "Why", "Who"],
    reasons: {
      received: "Delivered",
      transferred: "Transfer",
      used: "Used on a job",
      counted: "Count",
      written_off: "Loss",
    } as Readonly<Record<string, string>>,
    none: "Nothing has moved yet.",
    change: (quantity: number) => (quantity > 0 ? `+${String(quantity)}` : String(quantity)),
  },
  /** PLACEHOLDER: a refusal, said of the box it names (src/routes/ops-stock.ts). */
  errors: {
    consumable_code: "That consumable is not in the list any more. Reload the page.",
    from: "That kit is not one we know. Reload the page.",
    to: "Stock moves from one place to another, not to the place it is in. Nothing was recorded.",
    technician_id: "That kit is not one we know. Reload the page.",
    note: "Say what happened, in up to 200 characters. Nothing was recorded.",
    offline: "You are offline. Connect, then try again.",
    unknown: "That did not go through. Nothing was recorded.",
  } as Readonly<Record<string, string>>,
} as const;
