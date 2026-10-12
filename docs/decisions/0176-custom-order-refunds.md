# 0176. Custom order refunds

- Status: accepted
- Date: 2026-10-12
- Topic: Money and Books

## Context

A custom order is paid in full before it is ordered (ADR 0174). The owner ruled on 11 October 2026 that its client has their money back in full if the supplier is late past a grace period ops set, or the piece fails its check, and none if they cancel after the purchase order has gone.

## Decision

1. **A paid custom order is refunded in full, with Customer care MANAGE, for one of three reasons the API checks:** its purchase order has not gone out (drafted or approved, then cancelled with the refund); its supplier is late, the order sent and today past its promised date plus the grace; or its piece failed its check on arrival, which drafted a claim.
2. **The grace is an ops setting,** Admin › Settings › Purchasing, seven days until ops set their own.
3. **The refund is made once,** under the order's own receipt (ADR 0100); one Razorpay refuses or leaves unanswered tells ops to make it by hand.
4. **The order reads refunded,** with its reason, in the console and in the client's data export.

## Consequences

- A client who changes their mind after the order has gone is refused by the API, so no one refunds them by mistake.
- Books records the refund as any refund is, once Razorpay says it is processed.
- Tests: `test/worker/ops/custom-orders.test.ts`.
