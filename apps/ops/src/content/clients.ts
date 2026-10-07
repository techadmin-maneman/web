// A client's page, and finding one (board B): their visits, pieces, consents, payments, photos and profile.

import { FAILED, NOT_PERMITTED, OFFLINE } from "./common.ts";

export const clients = {
  title: "Clients",
  /** A cell with nothing in it, written as the design's tables write a gap. */
  unknown: "—",
  /**
   * The board opens on a client page and draws no way of reaching
   * one. What ops type is sent in the request body, never in a path or a query
   * string, so a number stays out of URLs, referrers and logs.
   */
  find: {
    label: "Name or number",
    hint: "Part of a name, or 4+ digits of a number.",
    submit: "Find",
    finding: "Looking",
    /** The matches, by name, each a way to the client's page. */
    found: "Clients",
    none: (text: string) => `No match for “${text}”.`,
    more: "Too many matches. Narrow the search.",
    /** Beside each match, so two of one name can be told apart. */
    nextVisit: (when: string) => `Next visit ${when}`,
    noVisit: "No visit booked",
    /** The clients opened this session, offered before anything is searched for. */
    recent: "Recent",
    errors: {
      not_permitted: NOT_PERMITTED,
      invalid_request: "Type 2+ letters of a name, or 4+ digits.",
      offline: OFFLINE,
      unknown: FAILED,
    } as Readonly<Record<string, string>>,
  },
  /**
   * The line beneath the name. The board draws five: tier, status, the usual
   * technician, credits and when a replacement is due. Nothing records a tier
   * or a usual technician (docs/fidelity-method.md); the replacement date is
   * the piece in wear's, as a month, exactly as the board writes it. The
   * mobile is ours: the board draws a WhatsApp button and no number to call.
   */
  meta: {
    state: "Status",
    credits: "Free service visits",
    replacement: "Replacement due",
    mobile: "Mobile",
    // Who invited the client, and the invite's code beside their name: "Vikram Sethi (VSAB23)".
    invitedBy: "Invited by",
    inviteCode: (code: string) => `(${code})`,
  },
  /** The button beside the name, which opens a chat with the client. */
  whatsapp: "WhatsApp",
  whatsappLabel: (name: string) => `WhatsApp ${name}`,
  /** The number as a way to call, since a client who never agreed to WhatsApp is called. */
  callLabel: (name: string, mobile: string) => `Call ${name} on ${mobile}`,
  // The board writes "Active"; the API's three states are these.
  states: { fitted: "Fitted", lead: "Booked", nothing_booked: "Nothing booked" },
  /** The head's free service visits, as the client's Home writes them: "2 · use by 3 Jan 2028". */
  creditLine: (visits: number, expiry: string | null) =>
    expiry === null ? String(visits) : `${String(visits)} · use by ${expiry}`,
  /**
   * The board draws no client without a piece. A client wearing
   * none falls due on no date at all, so the head says so rather than drawing
   * the gap a missing figure would draw.
   */
  noPiece: "No hair system fitted",
  /** The tabs of the design's eight that the ops routes answer, in its order, and History, which it draws none of. */
  tabs: [
    { tab: "visits", label: "Visits" },
    { tab: "pieces", label: "Hair" },
    { tab: "payments", label: "Payments" },
    { tab: "referrals", label: "Referrals" },
    { tab: "consents", label: "Consents" },
    { tab: "photos", label: "Photos" },
    { tab: "history", label: "Overview" },
  ],
  /**
   * Our words, all of them: what waits on Tasks for the client, under the page's head, each with how long it has left
   * and where it is done. No board draws it.
   */
  openTasks: {
    title: "Open tasks",
    none: "Nothing open.",
    failed: "Couldn't load open tasks.",
    /** A task done on a tab of the client's page: "Go to Payments". */
    toTab: (tab: string) => `Go to ${tab}`,
  },
  failed: "Couldn't load this client.",
  /*
   * Our words, all of them: the board draws a Visits tab and nothing in it. It
   * is the record's own address and visits, which the page already holds, and
   * the form to record an address the client gives ops on the phone, which
   * searches for their building and saves it (docs/decisions/0092-task-owners.md).
   */
  visits: {
    /** The client's note to the technician, under the visit it is on. */
    clientNote: (text: string) => `Their note: “${text}”`,
    address: "Visits go to",
    noAddress: "No address yet.",
    access: "Access",
    // The address a client gave ops on the phone, which no board draws (docs/decisions/0092-task-owners.md).
    landmark: "Landmark",
    givenToOps: "Given on the phone",
    /** "To priya@maneman.in, 28 Sep 2026". */
    givenTo: (who: string, when: string) => `To ${who}, ${when}`,
    /** "Closed without a follow-up by priya@maneman.in, 28 Sep 2026", and ops' reason after it. */
    closedWithout: (who: string, when: string) => `Closed without follow-up by ${who}, ${when}`,
    /** The form a member of staff saves an address a client gives them with, which the app's own save follows. */
    given: {
      open: "Add an address",
      change: "Replace address",
      title: "Address given by phone",
      note: "Saved as their address. They can change it in the app.",
      building: {
        label: "Building",
        hint: "Search and choose it, so the technician gets a pin.",
        unavailable: "Search is unavailable. Type the address below.",
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
      accessHint: "Gate code or parking. Shown to the technician the day before.",
      invalid: "Add the flat, building or street, area, city and a 6-digit pincode.",
      save: "Save address",
      saving: "Saving…",
      cancel: "Cancel",
      saved: "Address saved.",
      failed: FAILED,
    },
    upcoming: "To come",
    past: "Done",
    columns: ["Date", "Time", "Visit", "Technician", "State", "Discount code"],
    onBoard: "Show on board",
    /** The link's whole name, since every row's says the same. */
    onBoardLabel: (visit: string) => `Show on board: the visit of ${visit}`,
    /**
     * A discount code on a visit, which no board draws (docs/decisions/0108-discount-codes.md).
     * Entered or taken off only while the visit is not paid for or invoiced.
     */
    code: {
      none: "None",
      /** "TENOFF, Rs. 200 off": what it takes off before GST, once the visit's price is known. */
      applied: (code: string, off: string | null) => (off === null ? code : `${code}, ${off} off`),
      givenBy: { client: "by the client", technician: "by the technician", ops: "by ops" } as Readonly<
        Record<string, string>
      >,
      /** A one visit's code the client typed when booking on the site, which "Enter a code" starts from. */
      requested: (code: string) => `Client entered ${code} when booking`,
      enter: "Enter a code",
      /** The button's whole name, since every row's says the same. */
      enterLabel: (visit: string) => `Enter a discount code on the visit of ${visit}`,
      label: "Discount code",
      apply: "Apply",
      applying: "Applying",
      cancel: "Cancel",
      remove: "Remove",
      removeLabel: (visit: string) => `Take the discount code off the visit of ${visit}`,
      removing: "Removing",
      errors: {
        not_permitted: NOT_PERMITTED,
        code_not_applicable: "That code doesn't apply to this visit.",
        code_off: "That code is switched off.",
        already_discounted: "This visit already has a code.",
        price_settled: "Paid or invoiced. The code can't change.",
        not_found: "Already removed.",
        offline: OFFLINE,
        unknown: FAILED,
      } as Readonly<Record<string, string>>,
    },
    noUpcoming: "Nothing booked.",
    noPast: "No past visits.",
    /** A booking that refunded its payment by itself, which no board draws. The client is told. */
    autoRefunds: {
      title: "Refunded bookings",
      /** "Service visit, 24 Sep 2027 · Rs. 2,000". */
      what: (visit: string, date: string, amount: string | null) =>
        amount === null ? `${visit}, ${date}` : `${visit}, ${date} · ${amount}`,
      /** "Refunded automatically on 22 Sep 2027: paid after the hold lapsed." */
      why: (when: string, reason: string) => `Auto-refunded on ${when}: ${reason}.`,
      reasons: {
        lapsed: "paid after the hold expired",
        not_movable: "the visit could no longer be moved",
      },
    },
    /**
     * Our words, all of them: booking a visit for the client from the console, which no board draws. Every kind; a
     * paid visit goes out as a payment link, and is booked once the client pays.
     */
    book: {
      open: "Book a visit",
      title: (name: string) => `Book a visit for ${name}`,
      close: "Close",
      kind: "Visit",
      kinds: {
        consultation: "Consultation",
        one_visit: "Consultation and fit together",
        first_fit: "First fit",
        service: "Service visit",
        replacement: "Replacement",
      },
      service: "Service",
      hairSystem: "Hair system",
      day: "Day",
      window: "Window",
      technician: "Technician",
      anyone: "Anyone available",
      earlier: "Earlier days",
      later: "Later days",
      noDays: "No one is free on these days.",
      code: "Discount code (optional)",
      codeHint: "Applied before GST.",
      pays: {
        nothing: "Nothing to pay.",
        oneVisit: "Nothing to pay now. A payment link goes out once they're fitted.",
        credit: (left: number) => `Uses a free service visit. ${String(left)} left.`,
        link: (amount: string) => `${amount} before any code. They get a payment link by SMS. Booked once paid.`,
      },
      book: "Book",
      booking: "Booking…",
      /** "Service visit, Wed 23 Sep, morning, with Sandeep Rawat." */
      summary: (visit: string, day: string, window: string, technician: string) =>
        `${visit}, ${day}, ${window}, with ${technician}.`,
      outcomes: {
        booked: "Booked.",
        being_booked: "Booked. On the dispatch board within a minute.",
        awaiting_payment: (amount: string, until: string) =>
          `Payment link sent for ${amount}. Slot held until ${until}. Booked once paid.`,
      },
      link: "Payment link",
      loading: "Finding free windows…",
      unreadable: "Couldn't load free windows.",
      retry: "Try again",
      errors: {
        taken: "That window was just taken. Choose another.",
        already_booked: "Already booked, or a payment link is open for one.",
        not_bookable: "That day or service can't be booked.",
        no_product: "No hair system on sale that day.",
        code_not_applicable: "That code doesn't apply to this visit.",
        code_off: "That code is switched off.",
        terms_changed: "Their last credit was just used elsewhere. Check, then book again.",
        unavailable: "Razorpay couldn't create the link. Try again in a minute.",
        not_found: "This client can't be booked.",
        offline: OFFLINE,
        unknown: FAILED,
      } as Readonly<Record<string, string>>,
    },
    /**
     * Our words, all of them: ops cancelling a client's visit, which no board draws. Free to the client unless ops
     * apply the client's own late terms, with a reason.
     */
    cancel: {
      open: "Cancel",
      /** The button's whole name, since every row's says the same. */
      openLabel: (visit: string) => `Cancel the visit of ${visit}`,
      drawer: "Cancel visit",
      title: (name: string) => `Cancel ${name}'s visit`,
      close: "Close",
      loading: "Checking refund…",
      unreadable: "Couldn't check the refund.",
      retry: "Try again",
      paid: {
        money: (amount: string, method: string) => `Paid ${amount} by ${method}.`,
        credit: "Paid with a free service visit.",
        nothing: "Nothing paid.",
      },
      /** Where a refund goes, by the payment's method. */
      destinations: { upi: "UPI", card: "card", netbanking: "bank account" } as Readonly<Record<string, string>>,
      otherDestination: "payment method",
      free: "Free cancellation",
      clientTerms: "Late terms",
      /** "Free to the client: Rs. 2,000 goes back to their UPI." */
      terms: (which: string, gives: string) => `${which}: ${gives}`,
      gives: {
        refund: (amount: string, to: string) => `${amount} refunded to their ${to}.`,
        kept: (amount: string) => `${amount} kept.`,
        restored: "free service visit returned.",
        lost: "free service visit used.",
        nothing: "nothing to refund.",
      },
      lateTerms: "Apply late terms",
      lateHint: (hours: number) => `Only if they're cancelling within ${String(hours)} hours themselves.`,
      reason: "Reason",
      reasonHint: "Private. The client won't see it.",
      confirm: "Confirm cancellation",
      cancelling: "Cancelling…",
      /** "Cancelled. Rs. 2,000 goes back to their UPI." */
      done: (gives: string) => `Cancelled. ${gives.charAt(0).toUpperCase()}${gives.slice(1)}`,
      termsChanged: "The free window closed meanwhile. Check the refund, then cancel again.",
      errors: {
        not_permitted: NOT_PERMITTED,
        not_changeable: "Started, passed or already cancelled.",
        invalid_request: "Give a reason.",
        unavailable: "That didn't work. Try again in a minute.",
        offline: OFFLINE,
        unknown: FAILED,
      } as Readonly<Record<string, string>>,
    },
    /**
     * Our words, all of them: ops closing a visit by hand, for work whose technician's phone was lost before it sent
     * it. No board draws it.
     */
    handClose: {
      open: "Close by hand",
      openLabel: (visit: string) => `Close the visit of ${visit} by hand`,
      title: (name: string) => `Close ${name}'s visit by hand`,
      close: "Close",
      note: "For finished work lost with the technician's phone.",
      outcome: "Outcome",
      outcomes: { done: "Done", partial: "Partly done" },
      started: "Started",
      ended: "Finished",
      /** "On Mon 21 Sep, India time." */
      timesHint: (day: string) => `On ${day}, India time.`,
      reason: "What happened",
      reasonHint: "Saved with the visit.",
      confirm: "Close visit",
      closing: "Closing…",
      done: { done: "Closed as done.", partial: "Closed as partly done. A follow-up is on Tasks." },
      errors: {
        not_permitted: NOT_PERMITTED,
        already_closed: "Already closed or cancelled.",
        too_early_to_close: "The visit hasn't started yet.",
        times: "Times must be on the visit day, in order, and not in the future.",
        reason: "Say what happened.",
        not_found: "This visit no longer exists.",
        offline: OFFLINE,
        unknown: FAILED,
      } as Readonly<Record<string, string>>,
    },
    /** "9 am to 12 pm", as the dispatch drawer writes a window. */
    time: (from: string, to: string) => `${from} to ${to}`,
    types: {
      consultation: "Consultation",
      first_fit: "First fit",
      service: "Service visit",
      replacement: "Replacement",
    },
    /** "First fit · Mane Man Essential": the kind, and the service it was sold as where that says more. */
    what: (kind: string, service: string | null) => (service === null ? kind : `${kind} · ${service}`),
    /** A visit to come, by where it stands, and one done, by how it was closed. */
    stages: {
      booked: "Booked",
      in_progress: "In progress",
      done: "Done",
      closing: "Closing",
    },
    // "Not home" is ours; the board draws Done and Partial.
    outcomes: { done: "Done", partial: "Partial", no_show: "Not home" },
    statuses: { cancelled: "Cancelled", terminated: "Not done", other: "—" } as Readonly<Record<string, string>>,
    /** Paid ahead, or covered by a credit: the client app's own badge. */
    prepaid: "Prepaid",
  },
  /*
   * Our words, all of them: the board draws a Payments tab and nothing in it.
   * It is the record's own payments and refunds, and the credits a client can
   * be given or have taken away by hand (docs/decisions/0068-a-paid-hold-is-kept.md).
   */
  payments: {
    title: "Payments and refunds",
    columns: { date: "Date", what: "What", amount: "Amount", state: "State" },
    none: "No payments yet.",
    /** "Service visit of 22 Aug 2027", and a late fee named as one. */
    visit: (type: string, date: string) => `${type} of ${date}`,
    unlinked: "Payment",
    lateFee: "Late fee",
    refund: "Refund",
    paymentStates: {
      authorized: "Processing",
      captured: "Paid",
      refunded: "Refunded",
      partially_refunded: "Partly refunded",
    } as Readonly<Record<string, string>>,
    refundStates: { created: "Processing", processed: "Refunded", failed: "Failed" } as Readonly<
      Record<string, string>
    >,
    reference: (reference: string) => `Ref ${reference}`,
    /** What a late change or a no-show's charge kept of the payment: "Rs. 2,000 kept, cancelled late". */
    kept: (amount: string, why: string) => `${amount} kept, ${why}`,
    keptFor: { cancelled: "cancelled late", moved: "moved late", no_show: "not home" },
    // A discount code on a payment, which no board draws (docs/decisions/0108-discount-codes.md).
    /** "Code AUDTEST, Rs. 1,000 off", beneath what the payment was for. */
    code: (applied: string) => `Code ${applied}`,
  },
  /* Our words, all of them: the payment links Razorpay texted the client, and an open one's address to send again. */
  links: {
    title: "Payment links",
    columns: { sent: "Sent", for: "For", amount: "Amount", state: "State" },
    none: "No payment links yet.",
    unsent: "Not sent",
    /** "Natural hair system, visit of 25 Sep 2027". */
    what: (product: string, day: string | null) => (day === null ? product : `${product}, visit of ${day}`),
    states: {
      making: "Creating",
      open: "Unpaid",
      paid: "Paid",
      refused: "Refused by Razorpay",
      lapsed: "Closed unpaid",
    },
    paidOn: (date: string) => `Paid ${date}`,
    reference: (reference: string) => `Ref ${reference}`,
    copy: "Copy link",
    copied: "Copied",
  },
  /* Our words, all of them: where each finished visit's invoice stands in Books. */
  invoices: {
    title: "Invoices",
    columns: ["Visit", "Invoice"],
    none: "No invoices yet.",
    states: { to_raise: "Not raised", draft: "Draft in Books", issued: "Sent" },
    sentOn: (date: string) => `Sent ${date}`,
  },
  /** Putting a client's free service visits right by hand (POST /api/clients/{id}/credits). */
  credits: {
    title: "Free service visits",
    balance: "They hold",
    none: "None",
    visits: (count: number) => `${String(count)} ${Math.abs(count) === 1 ? "visit" : "visits"}`,
    /** After the count, as the head writes it: "2 visits · use by 3 Jan 2028". */
    useBy: (date: string) => `use by ${date}`,
    change: "Add, or remove with a minus",
    changeHint: "-12 to 12, not 0.",
    reason: "Reason",
    reasons: [
      { reason: "correction", label: "Correction" },
      { reason: "goodwill", label: "Goodwill" },
    ],
    note: "The client sees the new balance in their app.",
    save: "Update credits",
    saving: "Saving",
    saved: (count: number) => `Done. They now have ${String(count)} ${count === 1 ? "visit" : "visits"}.`,
    errors: {
      not_permitted: NOT_PERMITTED,
      invalid_request: "-12 to 12, and no more than they hold.",
      not_found: "This client no longer exists.",
      offline: OFFLINE,
      unknown: FAILED,
    } as Readonly<Record<string, string>>,
  },
  /*
   * Our words, all of them: the design draws a Referrals tab and nothing in it. Who sent the invite heads the page; the
   * tab says what it earns, or gives a way to attach one for a friend who booked away from its page.
   */
  invite: {
    title: "Invite",
    erased: "Erased client",
    grant: "Reward",
    grants: {
      pending: "Given once this client is fitted",
      held: "Held for review",
      approved: "Given",
      granted: "Given",
      rejected: "Rejected",
      expired: "None: the invite lapsed",
      clawed_back: "Reversed: first fit refunded",
    },
    since: "Since",
    attachedBy: "Attached by",
    why: "Reason",
    none: "No invite. If a friend referred them, attach the invite here.",
    /** The same, to a person whose access does not let them attach one. */
    noInvite: "No invite.",
    form: {
      code: "Invite code",
      codeHint: "What follows maneman.in/r/ in the friend's link.",
      reason: "Reason",
      reasonHint: "What the client or friend told you.",
      /** The rules the API holds an attach to (src/routes/ops/client-referral.ts), the late one src/policy/fraud-holds.ts's. */
      note: "Not for the referrer themselves, or a client who already has an invite. After a first fit, it's held for review.",
      save: "Attach invite",
      saving: "Attaching",
      errors: {
        not_permitted: NOT_PERMITTED,
        unknown_invite: "No invite with that code.",
        own_invite: "That's their own invite.",
        invalid_request: "Enter the code and a reason.",
        not_found: "This client no longer exists.",
        offline: OFFLINE,
        unknown: FAILED,
      } as Readonly<Record<string, string>>,
    },
    news: {
      attached: "Invite attached.",
      already_invited: "Already attached.",
    },
  },
  /** Every piece the client has been fitted with. */
  pieces: {
    title: "Hair systems",
    /** The board's six columns. */
    columns: {
      code: "Hair system",
      base: "Base",
      fitted: "Fitted",
      lot: "Supplier lot",
      due: "Replace due",
      failure: "Failed · reason",
    },
    /** A piece that has failed, as the board writes it: "24 Jun · base split at crown". */
    failed: (date: string, reason: string | null) => (reason === null ? date : `${date} · ${reason}`),
    // The board draws no client without a piece, and every client has none until they are fitted.
    empty: "No hair system fitted yet.",
  },
  /*
   * Our words, all of them: no board draws the client's hair profile (docs/decisions/0106-a-clients-hair-profile.md).
   * The codes are the API's.
   */
  profile: {
    title: "Hair profile",
    none: "No hair profile yet.",
    /** "21 Sep 2026 · Imran, at the consultation", as each version is headed. */
    version: (date: string, by: string) => `${date} · ${by}`,
    atVisit: (name: string, visit: string) => `${name}, at the ${visit.toLowerCase()}`,
    byOps: (staff: string) => `${staff}, correction`,
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
    correct: "Correct profile",
    record: "Add profile",
    formTitle: "Correct hair profile",
    formNote: "Saved as a new version. Earlier versions are kept.",
    notRecorded: "Not recorded",
    product: "Hair system",
    invalid: "Check this field.",
    refused: "Check the marked fields.",
    failed: FAILED,
    moved: "The profile changed while you were editing. Not saved. Review the latest version.",
    save: "Save new version",
    saving: "Saving",
    cancel: "Cancel",
  },
  photos: {
    locked: "Locked",
    title: (name: string) => `Photos of ${name}`,
    /** Why a client's visits are photographed, which no consent switches off. */
    basis: "Taken at every visit for the record.",
    /** The board's words, with the client's first name where it writes "Rohit". */
    warning: (firstName: string) =>
      `Opening these is logged with your name and the time. The city head and ${firstName} can see the log.`,
    open: "View photos",
    /** The state the board draws once they are open, with the time the API logged the opening, by its own clock. */
    opened: (time: string) => `Open · logged ${time}`,
    /**
     * The board writes who opened them last ("AK · 19 Sep"); this
     * is the log it promises the city head, each opening before this one.
     */
    before: "Opened before",
    beforeRow: (by: string, date: string, time: string) => `${by} · ${date}, ${time}`,
    neverBefore: "Never opened before.",
    /** The earlier visits' photographs, fetched only when asked for. */
    earlier: (visits: number) => `Show ${String(visits)} earlier ${visits === 1 ? "visit" : "visits"}`,
    angles: { front: "Front", top: "Top", left: "Left", right: "Right", hair: "Hair" },
    // The board draws one visit's five angles; a visit has a set before and a set after.
    phases: { before: "Before", after: "After" },
    /** The board's caption beneath a visit's photographs: "22 Aug 2027 · service visit · Imran". */
    caption: (date: string, type: string, technician: string) => `${date} · ${type} · ${technician}`,
    // The four visit types, as the board's caption writes one.
    types: {
      consultation: "consultation",
      first_fit: "first fit",
      service: "service visit",
      replacement: "replacement",
    },
    // A photograph's description for a screen reader; the board draws no captions.
    alt: (angle: string, phase: string, date: string) => `${angle}, ${phase.toLowerCase()} the visit of ${date}`,
    // The board draws no client without photographs, and no photograph that would not load.
    empty: "No photos yet.",
    errors: {
      not_permitted: NOT_PERMITTED,
      unavailable: "Couldn't log the view, so photos stay locked.",
      offline: OFFLINE,
      unknown: "Photo didn't load.",
    } as Readonly<Record<string, string>>,
  },
  consents: {
    title: "Consents",
    /** The board's four columns. */
    columns: { purpose: "Purpose", state: "State", date: "Date", source: "Source" },
    purposes: {
      photos_own_record: "Photos for the visit record",
      photos_referral_cards: "Photos on referral cards",
      photos_marketing: "Photos in marketing",
      whatsapp_visits: "WhatsApp about visits",
      whatsapp_launches: "WhatsApp about launches",
    },
    states: { given: "Given", not_given: "Not given", withdrawn: "Withdrawn" },
    /**
     * Where each consent was given (docs/decisions/0094-where-a-consent-was-given.md). The board writes
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
      message_link: "Stop link",
      whatsapp_stop: "STOP reply",
    },
    /**
     * A consent with no place kept: given before this release on a notice several places showed, written
     * by the Worker it replaced before it was deployed, or switched from a copy of the app loaded before it.
     */
    notRecorded: "Not recorded",
    /** The board's note. It writes "from his own app"; this says "their" (docs/fidelity-method.md). */
    note: "Only the client can give consent, in their app.",
    /**
     * The board draws no deletion request, and the route answers
     * with the client's latest one, which belongs beside their consents.
     */
    deletion: {
      requested: (date: string) => `Deletion requested ${date}. Decide it in Deletion requests.`,
      rejected: (date: string) => `Deletion requested ${date}, rejected.`,
    },
  },
  /**
   * Our words, all of them: no board draws erasing a client from their page. It is for a request made outside the
   * app, on WhatsApp or the phone; one made in the app is decided in Deletion requests, which tells the client.
   */
  erasure: {
    title: "Erase client",
    note: "For deletion requests made outside the app. Can't be undone.",
    open: "Erase",
    openLabel: (name: string) => `Erase ${name}`,
    confirmLabel: (name: string) => `Erasing ${name}`,
    warning: "This erases them now. It can't be undone.",
    /** The runbook's first step, "Check the request comes from the number's owner". */
    checked: "I've confirmed this with them, on their own number.",
    confirm: "Erase now",
    cancel: "Cancel",
    erasing: "Erasing",
    /** Why nothing was erased, and what ops may do about it. */
    owed: {
      visit_booked: "They have a visit booked. Cancel it on Visits, which refunds them, then erase.",
      payment_held: "A refund is still owed. Erase once Payments shows it refunded.",
      payment_owed: "A payment link is still unpaid.",
    },
    /** To erase today all the same, when what is owed cannot be settled first. */
    settle: {
      visit_booked: "I'll cancel and refund it by hand today.",
      payment_held: "I'll make sure it's refunded today.",
      payment_owed: "Cancel the link and write off what's owed.",
    },
    anyway: "Erase anyway",
    done: {
      title: "Erased",
      body: "Photos and details are gone. CRM and Books records are blanked within minutes. Let them know in the chat they asked in.",
      back: "Find a client",
    },
    /** The page of a client erased since, which keeps only their visits and money. */
    record: {
      title: "Erased client",
      /** Whose visit the panels that cancel or close one name. */
      whose: "the erased client",
      on: (date: string) => `Erased on ${date}. Visits and payments remain on record.`,
    },
    errors: {
      not_permitted: NOT_PERMITTED,
      not_found: "Already erased. Reload.",
      offline: OFFLINE,
      unknown: "That didn't work. Nothing was erased.",
    } as Readonly<Record<string, string>>,
  },
  /*
   * The client's record in figures (src/domain/visits/client-history.ts). The design
   * draws no such tab, so every line below is a placeholder; the figures
   * themselves are the ones the board's own drawer implies, "Visits so far: 11
   * · last 22 Aug", and the head's "Replacement due".
   *
   * A count of nought is a true nought and is written as one. A figure nothing
   * records is written in words, never as a dash or a zero (PR #89, PR #100).
   */
  history: {
    title: "Overview",
    rows: {
      firstFit: "First fit",
      visits: "Visits",
      services: "Service visits",
      replacements: "Replacements",
      lastVisit: "Last visit",
      replacement: "Replacement due",
      spend: "Paid",
    },
    /** A client we have never fitted, and one whose earlier visits were never recorded here, read the same. */
    noFirstFit: "No first fit",
    noVisit: "No visits yet",
    /** The day ops order a piece against, with the piece it is for, as the Tasks board names one. */
    due: (date: string, piece: string) => `${date} · ${piece}`,
    noPiece: "No hair system fitted",
    /** To Activity, narrowed to this client: what they did, and everything done to their record. */
    activity: "View activity",
  },
} as const;
