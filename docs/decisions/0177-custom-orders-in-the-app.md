# 0177. Custom orders in the app

- Status: accepted
- Date: 2026-10-12
- Topic: Field work

## Context

A client pays for a custom order before it is made, and waits weeks for it (ADR 0174). The scope gave them its progress in the app.

## Decision

1. **`GET /api/me/custom-orders`** answers the signed-in client's orders still in hand: awaiting payment, paid, ordered or arrived, with the day promised, the price, and while unpaid the link to pay by. Never the supplier or what it charges us.
2. **Home shows each beneath its prompt:** ready to order with a way to pay, paid and being placed, being made by the day promised, or arrived with a call to book the fit to come.
3. **It is read apart from Home and loaded apart from it,** so Home never waits on it, and the app's first load does not grow. Nothing shows where it cannot be read.

## Consequences

- An order cancelled or refunded leaves Home; the client's data export keeps its record.
- Tests: `test/worker/purchasing/custom-orders.test.ts`.
