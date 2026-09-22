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
