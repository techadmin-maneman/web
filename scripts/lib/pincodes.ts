// Reading data/pincodes/ncr-pincodes.csv (scripts/import-pincodes.ts).
//
// A pincode's area is the shortest name among its sub and head post offices, with the office's suffix taken
// off ("Saket SO South Delhi" becomes "Saket"): a name a client would recognise, until ops give better ones.

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

/** The shortest recognisable name among a pincode's sub and head offices. */
export function areaOf(officeNames: string, city: string): string {
  const names = officeNames
    .split(";")
    .filter((office) => /\s(SO|HO)(\s|$)/.test(office))
    .map((office) => office.replace(/\s(SO|HO)(\s.*)?$/, "").trim())
    .filter((name) => name !== "");
  return names.sort((a, b) => a.length - b.length)[0] ?? city;
}

/** One pincode as the import writes it: its launch as an instant, midnight in India on the day. */
export interface PincodeRow {
  readonly pincode: string;
  readonly area: string;
  readonly city: string;
  readonly served: boolean;
  readonly launchedAt: string | null;
}

const sqlText = (value: string | null) => (value === null ? "NULL" : `'${value.replaceAll("'", "''")}'`);

/**
 * The statement that loads the rows, replacing each pincode's with the file's.
 * An area ops have named from the console keeps its name (area_named_by,
 * migration 0041): the post offices' name is only ever the first guess.
 */
export function pincodeUpsert(rows: readonly PincodeRow[]): string {
  const values = rows.map(
    (row) =>
      `(${sqlText(row.pincode)}, ${sqlText(row.area)}, ${sqlText(row.city)}, ${row.served ? "1" : "0"}, ${sqlText(row.launchedAt)})`,
  );
  return `INSERT INTO serviceable_pincodes (pincode, area, city, served, launched_at) VALUES
${values.join(",\n")}
ON CONFLICT (pincode) DO UPDATE SET
  area = CASE WHEN serviceable_pincodes.area_named_by IS NULL THEN excluded.area ELSE serviceable_pincodes.area END,
  city = excluded.city, served = excluded.served, launched_at = excluded.launched_at;`;
}
