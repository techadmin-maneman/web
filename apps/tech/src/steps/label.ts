// A piece's label as the technician types it, checked on the phone with the API's own rule (src/config/pieces.ts). A
// label the API would refuse is caught here, where it can still be put right, rather than stopping the job's close-out
// on its way.

import { isPieceCode } from "../../../../src/config/pieces.ts";

/** A label as typed, as the API reads it: in capitals, with a space taken for the hyphen it stands for. */
export function asLabel(typed: string): string {
  return typed
    .toUpperCase()
    .replace(/^[\s-]+/, "")
    .replace(/[\s-]+/g, "-");
}

/** The label's format: "MM", a base code, digits and a letter, e.g. MM-STD-4417-B. */
export const isLabel = isPieceCode;
