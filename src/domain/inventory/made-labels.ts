// A piece fitted with no label on it (docs/decisions/0291-pieces-without-labels.md) is recorded under a label made
// for it from its visit, as our labels are made (./stock-units.ts): MM, NL for no label, a serial and its check letter.
// The same visit always makes the same one, so a step sent again records the same piece; one another visit's piece
// carries already is passed over for the next. Ops may write it on the piece, or print it, later.

import { sha256Hex } from "../../lib/hash.ts";
import { piecesLabelled } from "./pieces.ts";
import { labelOf } from "./stock-units.ts";

/** What a made label says in place of a product's three letters: no label was on the piece. */
const MADE = "NL";

/** The serials a made label is drawn from: seven digits, as a unit's label. */
const SERIALS = 10_000_000;

/** The most serials tried past the visit's own before giving up, which would take that many pieces made alike. */
const TRIES = 50;

/** The label a piece fitted on `visitId` with none on it is recorded under. */
export async function madeLabel(db: D1Database, visitId: string): Promise<string> {
  const start = Number.parseInt((await sha256Hex(visitId)).slice(0, 12), 16) % SERIALS;
  for (let step = 0; step < TRIES; step += 1) {
    const label = labelOf(MADE, (start + step) % SERIALS);
    const held = await piecesLabelled(db, label);
    if (held.every((piece) => piece.appointment_id === visitId)) return label;
  }
  throw new Error(`no made label is free near ${labelOf(MADE, start)}`);
}
