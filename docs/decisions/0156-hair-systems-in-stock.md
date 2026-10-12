# 0156. Hair systems in stock

- Status: accepted
- Date: 2026-10-12
- Topic: Field work

## Context

The stock ledger counted consumables only (ADR 0087), so the pieces a kit carries were not counted. The owner ruled on 5 October 2026 that the kit ledger counts pieces too, each kept at a level ops set as a consumable's is (open point 168), and on 11 October that a hair system's stock is kept by product, base size, colour, grey and density, matched exactly to the client: no cutting down.

## Decision

1. **A hair system is a stock code in the consumables' ledger**, counted in pieces. Its row of `consumables` holds its name, cost and levels, so the warehouse, hubs, stockrooms and kits hold it, and transfers, counts, losses, low stock and the reporting copy take it as any consumable (ADR 0155).
2. **Its spec is a row of `hair_systems`**: the product, by the tier of its first-fit service, the base's width and length in inches, the colour code, grey and density, as the hair profile records them (ADR 0106). No two stock codes share a spec. Its name is made from the product's name and the spec: "Mane Man Essential 8x10 1B, 20% grey, 100%".
3. **Ops add one in Settings, Consumables**, with Admin MANAGE: `POST /api/hair-systems`. Its cost, levels, retirement and deletion are a consumable's.
4. **A piece fitted comes out of the technician's kit as the piece step lands.** The job card lists the hair systems their kit holds, those made to the client's profile first: the product the client chose on a one visit, paid for on a first fit, or the profile's on a replacement, with the profile's base, colour, grey and density exactly. The step names the one picked as `stock_code`; once however often the step lands, and a later step naming another corrects by the difference. A piece from elsewhere names none, and nothing blocks the fit.
5. **A hair system is never a consumable a service uses**: the consumables step, and each service's expected use, leave them out, and the consumables step never gives one back.

## Consequences

- Lots and expiry, the warning when no exact match is in reach, and the dispatch of pieces between places build on these stock codes.
- Tests: `test/worker/ops/hair-systems.test.ts`, `test/node/dom/tech-piece-form.test.ts`, `e2e/ops/consumables.e2e.ts`, `e2e/tech/piece.e2e.ts`.
