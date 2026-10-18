// Pieces, as the pieces tab reads them. A piece falls due for replacement its package's months after it is fitted
// (src/policy/packages.ts).

/**
 * The label a technician types, e.g. "MM-STD-4417-B": "MM", a base code, digits
 * and a letter, in capitals. There is no barcode or QR code, so the code is
 * always typed by hand and matched here.
 */
const PIECE_CODE_PATTERN = /^MM-[A-Z0-9]{2,6}-\d{2,8}-[A-Z]$/;

export const isPieceCode = (code: string): boolean => PIECE_CODE_PATTERN.test(code);
