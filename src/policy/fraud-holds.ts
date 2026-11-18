// When a referral grant waits for ops' review (docs/decisions/0048-referrals.md), so one person cannot refer
// themselves or farm credits: the referrer and the friend share an address or a UPI handle, their numbers match, or the
// referrer passes the month's cap. Each is checked in fraudSignals (src/domain/referrals/referral-grants.ts). Razorpay
// gives us no card fingerprint (ADR 0025, item 21), so a shared card is no rule. Ops approve or reject each held grant.

/** Fits a referrer may have granted in a calendar month in India before the next is held: 5, as ruled; ops set it in Settings. */
export const REFERRAL_MONTHLY_CAP = 5;

/** Each rule a grant can meet, in the order above. The card fingerprint is not given to us (ADR 0025, item 21). */
export const FRAUD_SIGNALS = ["shared_address", "shared_upi", "monthly_cap", "same_mobile"] as const;
export type FraudSignal = (typeof FRAUD_SIGNALS)[number];

// Two more, which no fraud rule above covers: an invite ops attach after the friend's first fit waits for their review
// too, as a held grant's credits do (attached_after_fit), and so does a fit the friend declined to sign off
// (fit_not_signed).

/** Why a grant waits for ops: a fraud rule it met, an invite attached after the fit, or a fit not signed off. */
export const HOLD_REASONS = [...FRAUD_SIGNALS, "attached_after_fit", "fit_not_signed"] as const;
export type HoldReason = (typeof HOLD_REASONS)[number];
