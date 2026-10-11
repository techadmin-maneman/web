# 0123. Partner referral channels

- Status: accepted
- Date: 2026-10-11
- Topic: Referrals

## Context

Referrals were client to client only: each code belonged to a client, and one setting gave both sides free service visits (ADR 0048, ADR 0107). The owner ruled on 11 October 2026 that partners (salons, clinics, gyms, creators) refer clients as a channel of their own, rewarded by commission rather than visits.

## Decision

1. **A partner is not a client.** Its code and the people who came through it live in `referral_channels` and `channel_attributions`, beside the clients' tables. Those tables are pointed at by others, and a D1 migration cannot rebuild a table others point at (migration 0025). A partner's code is made as a client's is, and never collides with one.
2. **One invite a person.** Whoever used an invite first, a client's or a partner's, is theirs; the code that attributes a person checks both tables.
3. **The same invite page.** A partner's code opens the page a client's does, naming the partner ("Recommended by Looks Salon") and offering the friend the partner's own visits. A paused partner's code reads as one we do not have.
4. **The grant.** When the friend's first fit closes as done, and is paid where a one visit must be, the friend gets the partner's visits and the partner earns its commission, both at the terms in force then, kept with the attribution. No fraud rule runs, since a partner has no address or payment of ours to compare. A first fit refunded under the guarantee takes both back.
5. **Partners hear nothing from us** and have no login. Growth adds, changes and pauses them on Referrals, with what came through each and what each has earned.

## Consequences

- Commission is recorded, not paid: the payout comes from the payroll or payout tool. A monthly statement per partner is the next step.
- Open with the CA: tax deducted from commission. With counsel: partners see counts, never a client's name.
- Tests: `test/worker/referrals/partner-channels.test.ts`, `e2e/ops/partners.e2e.ts`, `e2e/refer-landing.e2e.ts`.
