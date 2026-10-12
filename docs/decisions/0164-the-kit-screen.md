# 0164. The kit screen

- Status: accepted
- Date: 2026-10-12
- Topic: Field work

## Context

A technician could see their kit only as the hair systems listed on a job card. The owner ruled on 11 October 2026 that a kit top-up counts only once the technician scans it in, that expired consumables are handed in, and that a piece that comes off is held as returned (ADR 0163) until it is handed back.

## Decision

1. **The tech app has a Kit screen**, opened from today: what the kit holds of each item, each lot's expiry beside it and an expired one marked; what is on its way to it; and the pieces to hand back. Never a cost.
2. **A top-up to a kit waits for the technician's scan** when ops send it so, as the console does by default: it leaves its place at once and is in transit until the technician receives it. A hair system's pieces are scanned one by one, and those not scanned went missing on the way, as a short receipt's are (ADR 0158); a consumable is received whole. Ops can still hand stock over in person, arriving at once.
3. **Handing back** marks each returned piece handed in at the place the kit hangs from, its unit with it, and sends all the kit's expired stock there in transit, for that place to receive.
4. **The Kit screen's writes need signal**, as a discount code does: the technician hears at once whether they landed, and they are no job's steps for the outbox to hold. The piece step, which runs where there is none, reads its kit from the job card.
5. **Audit:** a technician's receipt and hand-back are recorded under the tech surface, by the technician.

## Consequences

- An alert for a piece not handed in, and the evening check of tomorrow's kit, come with the supply plan.
- Tests: `test/worker/ops/kit.test.ts`, `e2e/tech/kit.e2e.ts`, `e2e/ops/stock.e2e.ts`.
