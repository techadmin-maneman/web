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
   * The sections the backend has routes for, in the design's order; the design
   * draws eight. Its third is drawn as "Payments" and built as "No-shows": the
   * day's money is there, over the queue, but the dispute the board rules on
   * has no record behind it (docs/open-points.md, item 57). Settings is the one
   * it draws that is not built; nothing here is settable.
   *
   * The last three are drawn on no board at all. They are what a client asks of
   * us about their own data, and every one was API-only until the P2-M6 proof
   * said so (docs/decisions/0049-dpdp.md, docs/fidelity-method.md).
   */
  sections: [
    { page: "/dispatch", label: "Dispatch" },
    { page: "/clients", label: "Clients" },
    { page: "/no-shows", label: "No-shows" },
    { page: "/referrals", label: "Referrals" },
    { page: "/waitlist", label: "Waitlist" },
    { page: "/tasks", label: "Tasks" },
    { page: "/technicians", label: "Technicians" },
    { page: "/grievances", label: "Grievances" },
    { page: "/deletion-requests", label: "Deletion requests" },
    { page: "/number-changes", label: "Number changes" },
  ],
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
  board: {
    /** A block, for whoever is reading with a screen reader or moving by keyboard. */
    block: (job: string, date: string, window: string) => `${job}, ${date}, ${window}`,
    /** PLACEHOLDER: the board draws no board without technicians. */
    empty: "No technician is on this board.",
    /** A day ops recorded leave on: no job can be dropped there, and none is offered (ADR 0060). */
    away: "Away",
    awayLabel: (technician: string, date: string) => `${technician} is away on ${date}`,
    /** Beneath the board, saying where leave comes from, since it is ours and not FSM's. */
    leave: "Leave is recorded on the Technicians screen. A day marked Away takes no job.",
  },
  tray: {
    title: "Unassigned",
    asked: (window: string) => `Asked · ${window}`,
    offered: (window: string) => `Offered · ${window}`,
    /** No Request behind the visit recorded a window, so there is nothing to compare (ADR 0061). */
    notAsked: "Asked · not recorded",
    /** Beneath the tray: where the asked window comes from, and why some rows have none. */
    same: "Asked is what the client picked on their booking. A visit booked without one says so.",
    // PLACEHOLDER: the board draws four waiting and no empty tray.
    empty: "Nothing is waiting for a technician.",
  },
  /** Board A3: the drawer a block opens, narrowed to what a block carries. */
  drawer: {
    /** Beneath the name: "Fri 19 Sep · 12 to 4 pm · Imran Qureshi". */
    when: (date: string, hours: string, technician: string) => `${date} · ${hours} · ${technician}`,
    rows: { type: "Type", area: "Area", state: "State" },
    /** "Service visit · 1 slot", as the board writes it; a first fit takes 2. */
    type: (name: string, slots: number) => `${name} · ${String(slots)} ${slots === 1 ? "slot" : "slots"}`,
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
    note: (job: string | null) =>
      `${job ?? "The client"} is messaged on WhatsApp with the new window. Their payment carries over.`,
    /** The board's extra line within 24 hours of the visit. */
    soon: "This visit is inside 24 hours. The client is not charged, because we moved it.",
    send: "Move and notify",
    sending: "Moving",
    cancel: "Cancel",
  },
  /** Choosing where a job lands, which the design does by dragging. */
  landing: {
    /** The bar above the board while a job is in hand. */
    moving: (job: string) => `Moving ${job}. Choose a technician and a window.`,
    /** Each window of each technician's day, while a job is in hand. */
    choose: (job: string, technician: string, date: string, window: string) =>
      `Move ${job} to ${technician}, ${date}, ${window}`,
    stop: "Stop moving it",
    moved: (job: string) => `${job} moved. The client has been messaged.`,
    /**
     * A refusal names the technician and the window it asked for: the clash check
     * runs before anything is written (ADR 0034), and the API answers with the
     * code alone.
     */
    clash: (technician: string, date: string, window: string) =>
      `${technician} already holds a job on ${date}, ${window}. Nothing was moved.`,
    /** Leave is named as leave, so ops know the day is off rather than merely full (ADR 0060). */
    onLeave: (technician: string, date: string) => `${technician} is away on ${date}. Nothing was moved.`,
    errors: {
      invalid_request: "That move is not one we can make. Nothing was moved.",
      not_found: "This visit is no longer live. Reload the board to see it as it stands.",
      fsm_refused: "Our scheduling system would not take it. Nothing was moved.",
      offline: "You are offline. Connect, then try again.",
      unknown: "That did not go through. Nothing was moved.",
    },
  },
} as const;

export const referrals = {
  title: "Referrals",
  queue: {
    title: "Held for review",
    /** The design writes "Rohit Malhotra → Vikram Sethi". */
    pair: (referrer: string, referred: string) => `${referrer} → ${referred}`,
    /**
     * PLACEHOLDER: the design writes how long the grant has waited ("3 days held"), which the
     * route does not give. It gives the day of the first fit that earned the grant.
     */
    fitted: (date: string) => `Fitted ${date}`,
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
      hint: "Kept with the decision, in the audit log.",
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
  },
} as const;

export const clients = {
  title: "Clients",
  /** A cell with nothing in it, written as the design's tables write a gap. */
  unknown: "—",
  /**
   * PLACEHOLDER: the board opens on a client page and draws no way of reaching
   * one. The number is asked for here and sent in the request body, never in a
   * path or a query string, so it stays out of URLs, referrers and logs.
   */
  find: {
    label: "The client's mobile number",
    hint: "Ten digits, or +91 and ten digits.",
    submit: "Find the client",
    finding: "Looking",
    errors: {
      invalid_request: "That is not an Indian mobile number.",
      not_found: "Nobody has that number. An erased client has no page.",
      offline: "You are offline. Connect, then try again.",
      unknown: "That did not go through. Please try again.",
    } as Readonly<Record<string, string>>,
  },
  /**
   * The line beneath the name. The board draws five: tier, status, the usual
   * technician, credits and when a replacement is due. Nothing records a tier
   * or a usual technician (docs/fidelity-method.md); the replacement date is
   * the piece in wear's, as a month, exactly as the board writes it.
   */
  meta: { state: "Status", credits: "Credits", replacement: "Replacement due" },
  // PLACEHOLDER: the board writes "Active"; the API's three states are these.
  states: { fitted: "Fitted", lead: "Booked", nothing_booked: "Nothing booked" },
  credits: (visits: number, expiry: string | null) =>
    expiry === null ? String(visits) : `${String(visits)} · expire ${expiry}`,
  /**
   * PLACEHOLDER: the board draws no client without a piece. A client wearing
   * none falls due on no date at all, so the head says so rather than drawing
   * the gap a missing figure would draw.
   */
  noPiece: "No piece fitted",
  /** The tabs of the design's eight that the ops routes answer, in its order, and History, which it draws none of. */
  tabs: [
    { tab: "pieces", label: "Pieces" },
    { tab: "consents", label: "Consents" },
    { tab: "photos", label: "Photos" },
    { tab: "history", label: "History" },
  ],
  failed: "We could not load this client.",
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
    /** The state the board draws once they are open, with the time the API logged the first one. */
    opened: (time: string) => `Open · logged ${time}`,
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
      unavailable: "The view could not be recorded, so the photograph is not shown.",
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
  /** A pincode we already come to, which cannot be launched again. PLACEHOLDER: the board draws only those waiting. */
  live: "Live",
  choose: (pincode: string, area: string) => `Mark ${pincode} live, ${area}`,
  // PLACEHOLDER: the board draws no empty waitlist.
  empty: "Nobody is waiting outside the areas we serve.",
  launch: {
    label: (pincode: string) => `Mark ${pincode} live`,
    title: (alerts: number) => `This messages ${String(alerts)} ${alerts === 1 ? "person" : "people"}`,
    rows: { waiting: "On the list", alerts: "Opted in to alerts", referred: "Held referral invites" },
    /**
     * What each of them gets. The words are launch_alert_v1's in
     * src/config/message-templates.ts, which is what the queue actually sends;
     * the first name is theirs, so the preview shows the placeholder.
     * test/node/ops-content.test.ts holds the two together.
     */
    message: (area: string, bookingUrl: string) =>
      `Hello {first name}, we now come to ${area}. Your free consultation can be booked here: ${bookingUrl}`,
    send: (alerts: number) => `Send to ${String(alerts)}`,
    sending: "Sending",
    cancel: "Not now",
    /** The board's note beneath the panel, with the figures filled in. */
    note: (quiet: number) =>
      `The ${String(quiet)} who did not opt in are not messaged. The count shows both so the gap is visible.`,
    done: (alerts: number) => `Launched. ${String(alerts)} on their way.`,
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
    /** The visit the case belongs to. The route gives its date and its technician, never the client. */
    visit: (date: string) => `Visit of ${date}`,
    /** PLACEHOLDER: a case whose appointment carries no date. */
    undated: "Visit, date unknown",
    attended: (technician: string) => `${technician} attended`,
    /** The four rows the board letters on the evidence, in its own words. */
    facts: { checkIn: "Check-in", distance: "Distance", whatsapp: "WhatsApp", waited: "Waited" },
    /** The board writes "240 m · over 200 m fence"; the route gives the distance, not the radius in force. */
    distance: (metres: number) => `${String(metres)} m`,
    /**
     * An address with no coordinates cannot be measured against, so the route
     * carries no distance (ADR 0036). Words rather than a number, because ops
     * charge a client on these facts and nothing was measured here at all.
     */
    unmeasured: "Not measured · the address has no location",
    delivered: (time: string) => `Delivered ${time}`,
    /** PLACEHOLDER: the board's receipt always arrived; one that never did is this. */
    notDelivered: "Never delivered",
    waited: (minutes: number, closed: string | null) =>
      closed === null ? `${String(minutes)} min` : `${String(minutes)} min · closed ${closed}`,
    /**
     * PLACEHOLDER: the board's buttons are Refund and Uphold, which rule on a
     * dispute. The route charges the visit or waives it, and nothing records a
     * dispute at all.
     */
    charge: "Charge",
    waive: "Waive",
    deciding: "Deciding",
    /** PLACEHOLDER: the board draws no note beneath the queue, and no amount anywhere. */
    note: "Charging records the decision. Nothing is taken from the client here.",
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
 * groups, of which two have something behind them; the other three here are
 * queues it does not draw (docs/open-points.md, item 58).
 */
export const tasks = {
  title: "Tasks",
  /** The head's count, in oxblood, as the board writes "4 overdue". */
  overdue: (count: number) => `${String(count)} overdue`,
  /** Each group, lettered in small caps as the board letters its own two. */
  groups: {
    replacement_order: "Replacement order",
    referral_review: "Referral review",
    no_show_decision: "No-show decision",
    number_change: "Number change",
    erasure_request: "Erasure request",
  } as Readonly<Record<string, string>>,
  /** The first line: whose task it is. A no-show names no client, so it names the visit. */
  visit: (date: string) => `Visit of ${date}`,
  /** PLACEHOLDER: a queue whose row has lost the client it was about. */
  unknown: "Client unknown",
  /** The client's page, which the board draws no way to. */
  open: (name: string) => `Open ${name}`,
  /** The second line, one per group: the one fact the group turns on. */
  subs: {
    /** "MM-STD-4417-C · due 1 Mar 2028". The board writes the supplier's lead time too; nothing records one. */
    replacement_order: (piece: string, due: string) => `${piece} · due ${due}`,
    no_show_decision: (technician: string) => `${technician} attended`,
    number_change: "Both numbers proven by code",
    erasure_request: "Asked for in the client's own app",
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
  /** Four of board D3's five columns; nothing records a skill, so the fifth is not drawn. */
  columns: ["Technician", "Zone", "Jobs", "Avg service"],
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
     * board letters 1 h 48 m in brass, 18 minutes past the 90 a service visit is
     * planned for, and leaves 1 h 31 m quiet. It writes no rule, and this is
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
    /** PLACEHOLDER: a phone whose browser gave no label at login. */
    unlabelled: "A phone",
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
   * hold it. It does not (ADR 0060), so leave is recorded here and every line
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
    hint: "Kept with the grievance and in the audit log, under your name.",
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
      hint: "Kept with the decision, in the audit log.",
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
      hint: "Kept with the decision, in the audit log.",
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
