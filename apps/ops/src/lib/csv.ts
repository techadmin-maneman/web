// The console's CSV files, each cell written so a spreadsheet shows it as the text it is. ./save-csv.ts hands one
// to the browser.

/**
 * A cell as a file writes it. One a spreadsheet would run as a formula -- it opens with = + - @, a tab or a carriage
 * return, and is not a plain number such as -1500.00 -- starts with an apostrophe, so it is shown as the text it is.
 * One holding a comma, a quote or a line break is quoted, with its quotes doubled.
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) && !/^-\d+(\.\d+)?$/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** Rows of cells as a file's text, a line each. */
export const csvText = (rows: readonly (readonly string[])[]): string =>
  rows.map((row) => row.map(csvCell).join(",")).join("\n");
