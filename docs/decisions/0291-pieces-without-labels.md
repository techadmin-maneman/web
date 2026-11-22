# 0291. A piece without a label never stops the fit

- Status: accepted
- Date: 2026-11-22
- Topic: Field work
- Amends [0163](0163-pieces-scanned-from-the-kit.md) and [0161](0161-pieces-as-units.md)

## Context

The owner ruled on 22 November 2026 that labels are optional for the technician's movements of stock and for the fit:
a missing label must not stop the installation. Until now the piece step asked for a label in our format, read or
typed, before Next would go; a fit whose piece had lost its label, or never had one, could not be finished. A
hair system's top-up arriving in the kit was received only by scanning each of its pieces.

## Decision

1. **The piece step takes "No label on it"** (`apps/tech/src/steps/Piece.tsx`). The technician picks the hair system
   from their kit, any of it, labelled or not, and Next goes. The step sends `no_label` and the stock code, no label.
2. **The piece is recorded under a label made for it** (`src/domain/inventory/made-labels.ts`): MM, NL for no label, a
   seven-digit serial drawn from the visit and its check letter, as our labels are made. The same visit always makes
   the same label, so a step sent again records one piece; one another visit's piece or a unit of stock carries is
   passed over. Every reader of a piece keeps working on a label: the client's pieces, a replacement's piece coming
   off, failures, recalls and supplier claims. Ops can write it on the piece, or print it, later.
3. **The piece leaves the kit as fitted** (`src/domain/inventory/piece-use.ts`): one of the hair system's pieces,
   unlabelled first, as a label we never made takes one, but fitted, not gone missing. A unit so taken carries the
   made label from then on, since a recall, a warranty and a supplier's failures find a unit's piece by its label.
4. **A top-up is received whole without scanning** (`apps/tech/src/kit/Arriving.tsx`): "No labels? Receive all", as
   the API already allowed.
5. **The console marks a made label** on the client's pieces: "MM-NL-0004417-K · no label".

## Consequences

- The pieces table keeps its label required, and no reader of it changes.
- A piece never labelled, taken where the kit has one, has no unit, so a recall of its lot does not find it; that was
  so before, for any piece fitted under a label we never made.
- A fit with no label tells nobody: the piece is fitted and recorded. Whether ops want a task to label such a piece at
  its next visit is left for later.
