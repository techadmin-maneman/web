# 0169. Supplier claims

- Status: accepted
- Date: 2026-10-12
- Topic: Field work

## Context

Receipts record what arrived damaged or failed its check, which never enters stock (ADR 0167). Technicians hand back pieces that came off clients (ADR 0163). The owner ruled on 11 October 2026 that returned pieces are claimed on the supplier under its warranty, and that a return outside warranty is written off with a reason and a photograph.

## Decision

1. **A claim is a row of `supplier_claims`,** numbered CL-0001 on, for one stock code from one receipt line: how many, why (damaged, failed its check, or under warranty), and one unit's price on the order, in its currency.
2. **A receipt drafts its own claims,** in its batch: one for a line's damaged units and one for those that failed their check.
3. **A returned piece handed in is traced to its supplier** by its unit's first move, the delivery a receipt line made. Its warranty runs from the receipt's day, in India, for the supplier's warranty days. Inside it, Operations ACT may claim it; a warranty claim is for that one piece. Any returned piece may instead be written off with why. Either way it is settled once, and its unit is written off.
4. **A claim moves on once each step:** drafted, then sent with a note (Operations ACT), then settled by Operations MANAGE as a credit of an amount, a replacement, or rejected. A drafted claim not worth sending is withdrawn with why. Each step is audited only when it lands.
5. **Operations › Purchasing** lists open claims and the latest settled, and the returned pieces to settle with each one's warranty.

## Consequences

- A write-off's photograph comes next, required then; a claim may carry one too.
- An accepted credit becomes a vendor credit in Books against the receipt's bill, after this.
- The supplier scorecard reads claims and failed checks from here.
- Tests: `test/worker/purchasing/supplier-claims.test.ts`, `e2e/ops/supplier-claims.e2e.ts`.
