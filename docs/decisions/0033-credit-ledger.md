# 0033. The credit ledger

- Status: accepted
- Date: 2026-09-22

## Context

A referral earns each side 3 service-visit credits, which expire 365 days after they are granted (ADR 0025, item 24). A booking can spend one; a free cancel gives it back; a late cancel of a credit booking loses it; a refunded first fit takes the grant back; and ops correct mistakes. The prompt asks for "an append-only `credit_ledger` with kinds `grant`, `redeem`, `restore`, `expire`, `clawback` and `adjust`", each entry with its source and an expiry, and "the balance is computed; never store a mutable counter."

## Decision

**`credit_ledger`** (migration 0021) holds one row per change, with signed `visits`:

- **A grant** adds visits, with its own expiry, and names its source: a referral attribution, ops, or the pre-January import.
- **Every other entry names the grant it draws on** (`grant_id`): a redeem (−1) or restore (+1) for an appointment, an expire or clawback (−what is left), or ops' adjust.
- **So each grant keeps its own expiry**, and a grant's remaining visits are its own plus everything drawn on it.

**Append-only in the database.** Triggers abort any `UPDATE` or `DELETE`, so no code path can edit history.

**Once per source.** A unique index lets a source grant a person once. Another lets an appointment redeem, or restore, a credit once. So a repeated job or message changes nothing.

**The balance is summed** (`creditBalance`) over grants still in date, with the soonest expiry for the credit tile. **Spending takes the grant that expires soonest** (`redeemCredit`).

## Spending (P2-M3)

**A credit covers a service visit whenever the client has one,** as board C5 draws it ("Credit covers it · payment skipped"). This applies to a new service visit, or one replacing a visit moved inside 24 hours.

- The hold says so (`credit: { remaining }`), and booking skips payment.
- Once the visit is booked, one credit is redeemed for it, from the grant that expires soonest.
- If a credit was spent elsewhere in the minutes between, the visit stands, as ops would let it.
- First fits, replacements and consultations are never covered: the credits are service visits.

**Changing a visit paid with a credit** (ADR 0046):

- Cancelling more than 24 hours out restores the credit, to the grant it came from.
- Cancelling inside 24 hours loses it ("a credit booking loses the credit").
- A free move keeps it with the visit. A late move of a service visit is charged, and the credit is not returned.

## Consequences

- Credits appear on Home (`GET /api/me`) and the Refer tab (`GET /api/refer`) once there is a balance.
- An erased person's ledger stays: it is a record of money's worth, like their payments.
