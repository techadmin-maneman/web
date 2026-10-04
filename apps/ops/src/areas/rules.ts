// What the API takes for a pincode and an area's name (src/routes/ops-settings.ts), so a box says so before a send.

/** Six digits, the first 1 to 8. */
export const PINCODE = /^[1-8]\d{5}$/;

/** A letter or a digit first, so a spreadsheet never reads it as a formula, then 2 to 40 characters in all. */
export const AREA_NAME = /^[\p{L}\p{N}][\p{L}\p{N} .,'()&-]{1,39}$/u;
