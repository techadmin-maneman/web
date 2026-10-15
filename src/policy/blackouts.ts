// Why a day is closed, as ops type it in the console and the API takes it.

/**
 * A letter or a digit first, so a spreadsheet opening an exported list never reads it as a formula, then up to 59 more
 * letters, digits, spaces and ordinary punctuation.
 */
const REASON = /^[\p{L}\p{N}][\p{L}\p{N} .,:;!?'’"()&/-]{0,59}$/u;

export const isBlackoutReason = (reason: string): boolean => REASON.test(reason);
