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
  /** The sections the backend has routes for; the design draws eight (docs/fidelity-method.md). */
  sections: [
    { page: "/referrals", label: "Referrals" },
    { page: "/waitlist", label: "Waitlist" },
  ],
} as const;

export const states = {
  loading: "Loading",
  failed: "We could not load this.",
  retry: "Try again",
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
    /** PLACEHOLDER: the API requires a reason to reject, which the board does not draw. */
    reason: {
      label: "Why you are rejecting it",
      hint: "Kept with the decision, in the audit log.",
      confirm: "Reject the grant",
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
