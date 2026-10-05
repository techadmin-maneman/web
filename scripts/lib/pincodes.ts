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

/** Everyone on a pincode's waitlist, and whether the pincode is served now: WAITING_QUERY's rows. */
export interface Waiting {
  readonly pincode: string;
  readonly served: number;
  readonly waiting: number;
}

export const WAITING_QUERY = `SELECT w.pincode, COALESCE(MAX(s.served), 0) AS served, COUNT(*) AS waiting
FROM waitlist_entries w LEFT JOIN serviceable_pincodes s ON s.pincode = w.pincode
GROUP BY w.pincode`;

/**
 * The pincodes the file would serve that are not served yet and have people waiting. The import tells nobody, so it
 * must not launch these: the console's launch does, and tells those who asked
 * (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).
 */
export function launchesWithPeopleWaiting(
  rows: readonly PincodeRow[],
  waiting: readonly Waiting[],
): { pincode: string; waiting: number }[] {
  const unservedWithPeople = new Map(
    waiting.filter((entry) => entry.served === 0).map((entry) => [entry.pincode, entry.waiting]),
  );
  return rows.flatMap((row) => {
    const people = unservedWithPeople.get(row.pincode);
    return row.served && people !== undefined ? [{ pincode: row.pincode, waiting: people }] : [];
  });
}

/**
 * The statement that loads the rows, replacing each pincode's with the file's.
 * An area ops have named from the console keeps its name, since area_named_by
 * says so: the post offices' name is only ever the first guess.
 */
export function pincodeUpsert(rows: readonly PincodeRow[]): string {
  const values = rows.map(
    (row) =>
      `(${sqlLiteral(row.pincode)}, ${sqlLiteral(row.area)}, ${sqlLiteral(row.city)}, ${row.served ? "1" : "0"}, ${sqlLiteral(row.launchedAt)})`,
  );
  return `INSERT INTO serviceable_pincodes (pincode, area, city, served, launched_at) VALUES
${values.join(",\n")}
ON CONFLICT (pincode) DO UPDATE SET
  area = CASE WHEN serviceable_pincodes.area_named_by IS NULL THEN excluded.area ELSE serviceable_pincodes.area END,
  city = excluded.city, served = excluded.served, launched_at = excluded.launched_at;`;
}
import { sqlLiteral } from "./sql-literal.ts";
