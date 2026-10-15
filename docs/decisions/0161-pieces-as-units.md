# 0161. Pieces as units

- Status: accepted
- Date: 2026-10-12
- Topic: Field work

## Context

The ledger counts the hair systems each place holds (ADR 0156), but not which pieces they are. The owner ruled on 11 October 2026 that every piece gets a printed QR label at the national warehouse, where suppliers deliver, and is followed by it from receipt to the client and back. Today's label format stays, and the QR holds the same code.

## Decision

1. **Every hair system piece received is a unit** (`stock_units`), with its own label: MM, the product's first three letters, a seven-digit serial and a check letter (`MM-STA-0000123-K`), which today's label check takes. A delivery of a hair system makes one unit per piece, held at the warehouse in the delivery's lot; one delivery labels at most 500.
2. **The ledger still keeps the counts.** Each movement of a hair system moves the units it names, or, naming none, takes them soonest to expire first and, of each lot, the pieces held before labels first. What it takes of each lot follows from the pieces it takes, so units and lots agree.
3. **A unit's state follows its movement**: held at a place, in transit to one, fitted, written off, or missing (a count that found fewer, a transfer that arrived short, a fit under a label we never made). Units in transit arrive first; those lost on the way are taken to be pieces never labelled. Each change adds a line to the unit's history (`stock_unit_events`), written only where its movement is.
4. **Pieces held before labels** stay in the ledger unlabelled. Ops label them where they are, from the Stock page; their lots are taken soonest to expire first.
5. **A lot of a consumable has a label for its boxes** (`MM-LT-0000042-Q`), made the first time it is printed.
6. **Labels print from the Stock page** to the warehouse's thermal printer, 50 by 25 mm: the QR code, the label, the stock code's name, and the lot and expiry. A hair system's delivery opens its labels to print.

## Consequences

- Scanning labels by phone, the piece step scanning its piece from the kit, and the technician's Kit screen build on units.
- Tests: `test/worker/inventory/stock-units.test.ts`, `e2e/ops/stock.e2e.ts`.
