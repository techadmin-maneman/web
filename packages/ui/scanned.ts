// A label as it was read in, made the way the API takes it (docs/decisions/0162-scanning-labels.md).

/** A label as the API takes it: trimmed, in capitals, however a hand or a scanner typed it. */
export const scanned = (text: string): string => text.trim().toUpperCase();
