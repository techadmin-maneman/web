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
  /** The sections the backend has routes for, in the design's order; the design draws eight. */
  sections: [
    { page: "/dispatch", label: "Dispatch" },
    { page: "/clients", label: "Clients" },
    { page: "/referrals", label: "Referrals" },
    { page: "/waitlist", label: "Waitlist" },
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
    /**
     * The board draws a cell of leave, and none is ever shown: FSM answers about
     * availability 48 hours ahead and the board is seven days
     * (docs/open-points.md, item 53).
     */
    leave: "Leave is not shown. FSM answers about availability 48 hours ahead, and this board is seven days.",
  },
  tray: {
    title: "Unassigned",
    asked: (window: string) => `Asked · ${window}`,
    offered: (window: string) => `Offered · ${window}`,
    /**
     * The two are always the same window: FSM holds one time on an appointment,
     * and no preference of the client's is read back (docs/open-points.md, item 54).
     */
    same: "Asked and offered are the same window: FSM holds one time on a visit.",
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
   * technician, credits and when a replacement is due. Nothing records a tier,
   * a usual technician or a replacement date (docs/fidelity-method.md).
   */
  meta: { state: "Status", credits: "Credits" },
  // PLACEHOLDER: the board writes "Active"; the API's three states are these.
  states: { fitted: "Fitted", lead: "Booked", nothing_booked: "Nothing booked" },
  credits: (visits: number, expiry: string | null) =>
    expiry === null ? String(visits) : `${String(visits)} · expire ${expiry}`,
  /** The two tabs of the design's eight that the ops routes answer. */
  tabs: [
    { tab: "photos", label: "Photos" },
    { tab: "consents", label: "Consents" },
  ],
  failed: "We could not load this client.",
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
