// The referrals queue and table: a grant held for review, and every referrer.

import { NOT_PERMITTED } from "./common.ts";

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
     * Board C1 requires a reason for both decisions
     * (docs/prompts/phase2-frontend.md) and draws no field for either.
     */
    reason: {
      label: { approve: "Why you are approving it", reject: "Why you are rejecting it" },
      /** The reason stays with the decision; the audit log names the decision and who made it (ADR 0031). */
      hint: "Kept with the decision, under your name.",
      confirm: { approve: "Approve the grant", reject: "Reject the grant" },
      cancel: "Keep it held",
    },
    /** The board draws no empty queue. */
    empty: "Nothing is held for review.",
    deciding: "Deciding",
    errors: {
      not_permitted: NOT_PERMITTED,
      not_found: "Someone has decided this one already. Reload to see the queue as it stands.",
      // A consultation and fit is sold only once paid, so its grant waits for the payment; it can be rejected now.
      not_paid:
        "The friend has not paid for their consultation and fit yet. Approve it once they have, or reject it now.",
      offline: "You are offline. Connect, then try again.",
      unknown: "That did not go through. Please try again.",
    } as Readonly<Record<string, string>>,
  },
  table: {
    title: "All referrers",
    /** The board's columns, less "Sent", which nothing counts (docs/fidelity-method.md). */
    columns: {
      referrer: "Referrer",
      opens: "Opens",
      consults: "Consults",
      fits: "Fits",
      granted: "Granted",
      redeemed: "Redeemed",
    },
    note: "Opens and consultations stay here. The client's tracker shows fits only.",
    // The board draws no empty table.
    empty: "Nobody has a referral code yet.",
    /** The table is read fifty referrers at a time, the busiest first. */
    more: "Show more referrers",
    loading: "Loading",
  },
} as const;
