# 0257. Razorpay is the only way to pay

- Status: accepted
- Date: 2026-11-12
- Topic: Money and Books
- Supersedes [0209](0209-paid-at-the-visit-by-upi.md) on how a new paid visit is paid

## Context

Production launched without online payment (ADR 0209): consultations booked themselves, ops booked paid visits, and the
client paid Mane Man by UPI at the visit. The owner ruled on 12 November 2026 (ruling 11) that Razorpay is live and is
the only way to pay: no cash, no UPI to Mane Man's account, no pay-at-the-visit.

## Decision

1. **Production.** `PAYMENTS_PROVIDER: "razorpay"`, the live key ID in `wrangler.jsonc` (it is public),
   `SELF_SERVE_BOOKING: "true"`. The key secret and the webhook secret are set by the owner with `wrangler secret put`,
   never in the repository. Staging uses test keys; the settings refuse a live key outside production and a test key in
   it.
2. **The guard.** The Worker refuses to start in production with any provider but Razorpay, and with self-serve
   booking off unless `OUTAGE_REQUESTS_ONLY` is set. That var is for an outage only: requests ops confirm, still paid by
   a Razorpay link.
3. **Every payment through Razorpay.** In the app, Checkout on the hold. A paid visit ops book goes out as a Razorpay
   payment link (`src/domain/money/payment-links.ts`) and is held until `payment_link.paid`, on the hold's own countdown;
   the app shows it as owed, with Pay opening the same link. A one visit and a custom order are paid by link, as before.
   The app says: "Every payment goes through Razorpay: in the app when you book, or by a Razorpay link we text you.
   Technicians never take cash or UPI."
4. **Pay-at-the-visit retired for new visits.** No new hold is marked `pay_at_visit`; `visit_booked_at_visit_v1` is not
   queued; no app offers paying at the visit. Rows already written, their receipts, the `upi:` payments and the
   `paid_by_upi` refund refusal stay, read-only. "UPI to record" stays until the last unpaid such visit is recorded, then
   goes.
5. **Charges come back.** A late change or a missed visit can keep money again. Their values stay ops' own in Settings ·
   Rules; the owner reviews them.

## In force

Items 1, 2 and 4 take effect with the second PR of the redesign, which the owner merges once live KYC, the live key, its
secrets, the live webhook and payment links on the live account are in place. Until then production runs as ADR 0209
says, and staging runs on Razorpay's test keys.
