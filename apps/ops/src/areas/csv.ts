// Reading and writing the service-area CSV in the browser
// (data/pincodes/README.md, docs/decisions/0061-ops-editable-inputs.md).
//
// The served pincodes are marked in a spreadsheet, which is a far better
// tool for 198 rows than any web form, so the console takes that file back
// rather than asking for the rows again. It reads only the three columns that
// are theirs -- pincode, served and launch_on -- and ignores every other one,
// so a file that still carries the post offices and the coordinates is fine
// and nothing in it can overwrite the reference data.
//
// All three must be there. A file saved without the served column would
// otherwise read as every pincode switched off, and one without launch_on as
// every launch date cleared.
//
// The splitter is scripts/lib/pincodes.ts's, kept here because the console
// cannot import a node script.

/** A row of a simple CSV: commas between fields, a field in double quotes may hold commas. */
function fields(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) {
      out.push(field);
      field = "";
    } else field += char;
  }
  out.push(field);
  return out;
}

export interface CsvRow {
  readonly pincode: string;
  readonly served: boolean;
  readonly launch_on: string | null;
}

const COLUMNS = ["pincode", "served", "launch_on"] as const;

/** Only the ISO form. Excel likes to save 01-10-2026, and guessing the month is how a launch date goes wrong. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** What a spreadsheet writes in a yes-or-no column. A blank is no, as the list we hand out writes it. */
const SERVED_WORDS: Readonly<Record<string, boolean>> = {
  yes: true,
  y: true,
  true: true,
  "1": true,
  no: false,
  n: false,
  false: false,
  "0": false,
  "": false,
};

export type CsvRead =
  | { readonly ok: true; readonly rows: readonly CsvRow[] }
  | { readonly ok: false; readonly reason: "header" }
  | { readonly ok: false; readonly reason: "served" | "date"; readonly pincode: string };

/** The three columns that are ops' own, from a file that may hold any number of others. */
export function readServiceAreaCsv(text: string): CsvRead {
  const [header = "", ...lines] = text.trim().split(/\r?\n/);
  const columns = fields(header).map((name) => name.trim().toLowerCase());
  if (!COLUMNS.every((column) => columns.includes(column))) return { ok: false, reason: "header" };
  const at = (row: readonly string[], name: (typeof COLUMNS)[number]): string =>
    (row[columns.indexOf(name)] ?? "").trim();

  const rows: CsvRow[] = [];
  for (const line of lines) {
    if (line.trim() === "") continue;
    const row = fields(line);
    const pincode = at(row, "pincode");
    if (!/^\d{6}$/.test(pincode)) continue;
    const served = SERVED_WORDS[at(row, "served").toLowerCase()];
    if (served === undefined) return { ok: false, reason: "served", pincode };
    const launch = at(row, "launch_on");
    if (launch !== "" && !ISO_DATE.test(launch)) return { ok: false, reason: "date", pincode };
    rows.push({ pincode, served, launch_on: launch === "" ? null : launch });
  }
  return { ok: true, rows };
}

/**
 * A cell as the list writes it. One a spreadsheet would run as a formula -- it
 * opens with = + - @, a tab or a carriage return -- starts with an apostrophe,
 * so it is shown as the text it is. One holding a comma, a quote or a
 * line break is quoted, with its quotes doubled.
 */
function cell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** The list as it stands, in the shape the file uses, so it can be edited and uploaded back. */
export function serviceAreaCsv(
  pincodes: readonly { pincode: string; area: string; city: string; served: boolean; launch_on: string | null }[],
): string {
  const lines = pincodes.map((each) =>
    [each.pincode, each.city, each.area, each.served ? "yes" : "no", each.launch_on ?? ""].map(cell).join(","),
  );
  return [["pincode", "city", "area", "served", "launch_on"].join(","), ...lines].join("\n");
}
