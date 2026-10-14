# 0202. Razorpay's events are queued, and every queue has its dead letters

- Status: accepted
- Date: 2026-10-14
- Topic: Payments
- Amends [0044](0044-payments-mirror.md) on how the webhook answers

## Context

Razorpay's webhook checked whether it had seen an event, then recorded the payment, booked the hold it paid for (which can ask Razorpay for a refund, with a ten-second timeout), recorded consents and raised alerts, and only then marked the event seen, all before it answered. Razorpay wants an answer within five seconds and switches off a webhook that keeps failing. Two deliveries of one event at once both passed the seen check. Every step is safe to apply twice, so money was never at risk, but the route held the payment logic and its SQL, and a slow D1 or refund could cost us the webhook.

No queue kept what it gave up on: a message still failing after its last retry was dropped, and only the consumers that count their own tries told anyone.

## Decision

1. **The webhook only takes the event.** It checks the signature, claims the event by its ID in one statement (`INSERT … ON CONFLICT DO NOTHING RETURNING`), so of two deliveries at once only one goes on, and puts the signed body on `mm-razorpay-<env>`. A claimed event is answered 200 at once. One the queue will not take is let go of, and answered 503, so Razorpay sends it again.
2. **A consumer applies it** (`src/queues/razorpay.ts`) through one domain function, `applyRazorpayEvent` (`src/domain/money/razorpay-events.ts`), which holds the SQL and the alerts the route did. A refund that comes before its payment, and does not carry it, is tried again a minute on, and later each time; anything that throws is tried again the same way.
3. **Every queue hands what it gives up on to `mm-dead-letters-<env>`,** whose consumer tells ops once of each message, by what it was and what settles it by hand (`dead_letter:<what>`, runbook "A queue gave up"), and lets it go.

## Consequences

- Each environment has two more queues, made with the others (docs/provisioning.md, step 1).
- An event is seen from the moment it is claimed: Razorpay's own retries of it are answered at once, and its retries are the queue's.
- A Razorpay event that dies is told to ops as a dead letter; the half-hourly catch-up asks Razorpay of every hold still waiting on a payment (ADR 0068), so a hold's payment is usually booked before anyone reads it.
- The tests deliver a queued event straight to its consumer (`deliverRazorpay`, test/worker/helpers.ts), so a test reads what the event did as it did before.
