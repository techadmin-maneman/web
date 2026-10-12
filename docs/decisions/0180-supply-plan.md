# 0180. Supply plan

- Status: accepted
- Date: 2026-10-12
- Topic: Field work

## Context

The owner chose a plan that drafts and a person who approves (11 October 2026). The scope's rule: reorder when what a place can use falls below what it needs over the supplier's lead time and a planning period, with safety stock; lend before buying; round orders to packs and minimums; approve, change the quantity, or reject with a reason, and keep the decision.

## Decision

1. **After each forecast run, the plan is drafted;** ops may draft it again from the latest run on its page. A draft replaces the last one's proposals, never what was decided.
2. **For each stock code and city,** what the city needs over the cheapest supplier's lead time and a period (`periodsCovering`), and its safety stock, the forecast's spreads added as spreads add, against what it can use: what its places hold, kits counting to their technician's city, and what is on its way to it, less what is reserved to custom orders.
3. **A short city borrows from a city with spare,** the city furthest short first, between their stockrooms; **then from the warehouse;** a city with no stockroom borrows nothing and its shortfall goes to the order.
4. **What is still short,** less the warehouse's spare and what is on order (approved, sent or part received), is ordered from the supplier who sells it cheapest, at least its minimum, in whole packs.
5. **Operations › Supply plan** lists each line with the figures behind it. Operations MANAGE approves it at the quantity left in its box, which sends its transfer or drafts its order (approved and sent as any order is), or rejects it with why. A line is claimed before its move is made; one whose move is refused goes back to proposed.

## Consequences

- Kit top-ups, from the evening check of tomorrow's visits, come next; the plan moves stock between stockrooms and the warehouse.
- Lines decided are kept with the run they came from, to learn from.
- Tests: `test/node/policy/supply-plan.test.ts`, `test/worker/ops/supply-plan.test.ts`, `test/dom/ops-supply-plan.test.ts`, `e2e/ops/supply-plan.e2e.ts`.
