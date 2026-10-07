// The referrals queue and table: a grant held for review, and every referrer.

import { FAILED, NOT_PERMITTED, OFFLINE } from "./common.ts";

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
      // The board draws the other three rules, not this one.
      same_mobile: "Same mobile number",
      // An invite ops attached after the friend's first fit.
      attached_after_fit: "Attached after the first fit",
    },
    approve: "Approve",
    reject: "Reject",
    /**
     * The design requires a reason for both decisions
     * (docs/prompts/phase2-frontend.md) and draws no field for either.
     */
    reason: {
      label: { approve: "Reason for approving", reject: "Reason for rejecting" },
      confirm: { approve: "Approve grant", reject: "Reject grant" },
      cancel: "Cancel",
    },
    /** The board draws no empty queue. */
    empty: "Nothing held for review.",
    deciding: "Saving",
    errors: {
      not_permitted: NOT_PERMITTED,
      not_found: "Already decided. Reload.",
      // A consultation and fit is sold only once paid, so its grant waits for the payment; it can be rejected now.
      not_paid: "The friend hasn't paid yet. Approve once they have, or reject now.",
      offline: OFFLINE,
      unknown: FAILED,
    } as Readonly<Record<string, string>>,
  },
  table: {
    title: "All referrers",
    /** The board's columns, less "Sent", which nothing counts (docs/fidelity-method.md). */
    narrow: "Filter referrers",
    columns: {
      referrer: "Referrer",
      opens: "Opens",
      consults: "Consults",
      fits: "Fits",
      granted: "Granted",
      redeemed: "Redeemed",
    },
    // The board draws no empty table.
    empty: "No referrers yet.",
    /** The table is read fifty referrers at a time, the busiest first. */
    more: "Show more",
    loading: "Loading",
  },
} as const;
