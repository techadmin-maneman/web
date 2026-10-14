# 0181. Tomorrow's kits

- Status: accepted
- Date: 2026-10-12
- Topic: Field work

## Context

The scope's evening check: each kit against its technician's visits tomorrow, a shortfall telling ops with a top-up already drafted. Bookings are never blocked by stock (ADR 0178).

## Decision

1. **From 5 pm in India, each hour, the stock watch checks tomorrow's kits:** each technician's visits tomorrow, a visit's consumables by its service's expected use, and a fit's hair system made to its client's profile, against what their kit holds, read by stock code and kit.
2. **Each shortfall is proposed as a top-up on the supply plan,** from the technician's city's stockroom, else the warehouse, replacing the evening's last proposals for that day. The plan's own redraft leaves them be.
3. **Ops are told once a kit a day** (`kit_short:<technician>:<date>`), linked to the Supply plan.
4. **An approved top-up waits for the technician's scan,** as every kit top-up does (ADR 0164); the Supply plan lists open proposals and what was decided in the last week.
5. **On the evening ops set, the check tops each kit up for the week** (amended 14 October 2026; `top_up_weekday` in the kit check's settings, Sunday unless changed): for each consumable, what its visits over the next seven days are expected to use and its kit level on top, so the kit ends the week no lower than its level. Hair systems stay with tomorrow's, which knows each client's. The line shows the level as its safety stock (`src/domain/inventory/kit-week.ts`).
6. **What is on its way to a kit counts as held** (amended 14 October 2026), so a top-up approved in one evening hour is not proposed again in the next. The chat is told a short kit by its technician's ID, as every alert is; the console names them.

## Consequences

- The tech app's Kit screen shows an approved top-up among what is coming.
- Tests: `test/worker/ops/kit-check.test.ts`.
