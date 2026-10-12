# 0163. Pieces scanned from the kit

- Status: accepted
- Date: 2026-10-12
- Topic: Field work

## Context

Each piece in a technician's kit now carries a label (ADR 0161), and labels can be scanned (ADR 0162). The piece step still had the technician pick the hair system from a list and type the label, so the two could disagree, and an expired piece could be fitted. The owner ruled on 11 October 2026 that the piece step scans the piece from the kit, that expired stock is blocked, and that a piece that comes off is held as returned.

## Decision

1. **The piece step scans the label**, or takes it typed. The job card lists each kit hair system's labelled pieces, with their lot and expiry, so a label scanned with no signal still names its hair system.
2. **A label one of the kit's pieces carries names its hair system and lot**: the app picks them, and the API records them whatever the step said.
3. **An expired piece is refused**: one whose lot expires before the visit's day keeps Next dim in the app, and the API refuses its label (`piece_code`).
4. **A piece that comes off at a replacement is held in the kit as returned** (`piece_returns`), once for each visit and label, whether or not it carries one of our labels; a unit of ours comes back into the kit with it, as returned. Handing it in comes with the Kit screen.

## Consequences

- The tech app's Kit screen lists returned pieces to hand in, and receives kit top-ups by scan.
- Tests: `test/worker/ops/piece-from-kit.test.ts`, `test/node/dom/tech-piece-form.test.ts`, `e2e/tech/steps-piece.e2e.ts`.
