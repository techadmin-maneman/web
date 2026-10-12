# 0182. The events calendar and the forecast on the Supply plan

- Status: accepted
- Date: 2026-10-12
- Topic: Field work

## Context

The forecast's baseline reads a calendar of uplifts (ADR 0179), but nothing let ops keep it, and the forecast itself showed only through the plan it drafted (ADR 0180). The scope asks for both on the Supply plan page.

## Decision

1. **The events calendar is kept from the Supply plan page:** an event has a name, a served city or every city, its first and last days, and a change in demand from −90% to +500%. Ops with Operations MANAGE add one or take one off; VIEW reads them. One ending before it starts, or set in a city not served, is refused naming the box.
2. **An event is taken off, never edited, and kept;** a correction is a new one. Each add and take-off is on the activity log (`demand_event.add`, `demand_event.remove`).
3. **The list shows events still to end, soonest first.** The next forecast run reads them; a run already made is not redone.
4. **The forecast shows one city at a time,** each item by name in a row, each period of the latest run a column from its first day, the expected use with the high case beneath where it is higher. The city picker lists the served cities.

## Consequences

- `GET /api/stock/forecast` names each item it lists.
- Tests: `test/worker/ops/demand-events.test.ts`, `test/dom/ops-supply-plan-planning.test.ts`, `e2e/ops/supply-plan.e2e.ts`.
