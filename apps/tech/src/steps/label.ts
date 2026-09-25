// A piece's label as the technician types it, checked on the phone with the
// API's own rule (src/config/pieces.ts; test/node/tech-content.test.ts holds
// the two to each other). A label the API would refuse is caught here, where it
// can still be put right, rather than stopping the job's close-out on its way.

/** The owner's format, ruled 24 September 2026: "MM", a base code, digits and a letter, e.g. MM-STD-4417-B. */
export const PIECE_LABEL = /^MM-[A-Z0-9]{2,6}-\d{2,8}-[A-Z]$/;

/** A label as typed, as the API reads it: in capitals, with a space taken for the hyphen it stands for. */
export function asLabel(typed: string): string {
  return typed
    .toUpperCase()
    .replace(/^[\s-]+/, "")
    .replace(/[\s-]+/g, "-");
}

export const isLabel = (label: string): boolean => PIECE_LABEL.test(label);
