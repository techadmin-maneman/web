// Reading and writing the service-area CSV in the browser
// (data/pincodes/README.md, docs/decisions/0061-ops-editable-inputs.md).
//
// The owner marks the served pincodes in a spreadsheet, which is a far better
// tool for 198 rows than any web form, so the console takes that file back
// rather than asking for the rows again. It reads only the three columns that
// are theirs -- pincode, served and launch_on -- and ignores every other one,
// so a file that still carries the post offices and the coordinates is fine
// and nothing in it can overwrite the reference data.
//
// The splitter is scripts/lib/pincodes.ts's, kept here because the console
// cannot import a node script.

/** A row of a simple CSV: commas between fields, a field in double quotes may hold commas. */
export function fields(line: string): string[] {
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

/** Only the ISO form. Excel likes to save 01-10-2026, and guessing the month is how a launch date goes wrong. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type CsvRead =
  | { readonly ok: true; readonly rows: readonly CsvRow[] }
  | { readonly ok: false; readonly reason: "header" }
  | { readonly ok: false; readonly reason: "date"; readonly pincode: string };

/** The three columns that are ops' own, from a file that may hold any number of others. */
export function readServiceAreaCsv(text: string): CsvRead {
  const [header = "", ...lines] = text.trim().split(/\r?\n/);
  const columns = fields(header).map((name) => name.trim().toLowerCase());
  const at = (row: readonly string[], name: string): string => {
    const index = columns.indexOf(name);
    return index === -1 ? "" : (row[index] ?? "").trim();
  };
  if (!columns.includes("pincode")) return { ok: false, reason: "header" };

  const rows: CsvRow[] = [];
  for (const line of lines) {
    if (line.trim() === "") continue;
    const row = fields(line);
    const pincode = at(row, "pincode");
    if (!/^\d{6}$/.test(pincode)) continue;
    const launch = at(row, "launch_on");
    if (launch !== "" && !ISO_DATE.test(launch)) return { ok: false, reason: "date", pincode };
    rows.push({ pincode, served: at(row, "served").toLowerCase() === "yes", launch_on: launch === "" ? null : launch });
  }
  return { ok: true, rows };
}

/** The list as it stands, in the shape the file uses, so it can be edited and uploaded back. */
export function serviceAreaCsv(
  pincodes: readonly { pincode: string; area: string; city: string; served: boolean; launch_on: string | null }[],
): string {
  const quote = (value: string) => (value.includes(",") ? `"${value}"` : value);
  const lines = pincodes.map((each) =>
    [each.pincode, quote(each.city), quote(each.area), each.served ? "yes" : "", each.launch_on ?? ""].join(","),
  );
  return [["pincode", "city", "area", "served", "launch_on"].join(","), ...lines].join("\n");
}
