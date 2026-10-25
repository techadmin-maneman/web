// What an area is called until ops name it (data/pincodes/README.md): the shortest name among a pincode's sub and head
// post offices, the office's suffix taken off ("Saket SO South Delhi" becomes "Saket", "Kothrud S.O" "Kothrud"), which a
// client recognises.

/** A name ops may give an area: a letter or a figure first, then words, up to 40 characters. */
export const AREA_NAME = /^[\p{L}\p{N}][\p{L}\p{N} .,'()&-]{1,39}$/u;

/** The shortest recognisable name among a pincode's sub and head offices. */
export function areaOf(officeNames: string, city: string): string {
  const names = officeNames
    .split(";")
    .filter((office) => /\s(S\.?O|H\.?O)(\s|$)/.test(office))
    .map((office) => office.replace(/\s(S\.?O|H\.?O)(\s.*)?$/, "").trim())
    .filter((name) => name !== "");
  return names.sort((a, b) => a.length - b.length)[0] ?? city;
}

/** A suggested name fitted to what ops may give an area, its odd marks taken out; else the fallback's. */
export function fittedArea(name: string, fallback: string): string {
  const fit = (raw: string) =>
    raw
      .replace(/[^\p{L}\p{N} .,'()&-]/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 40)
      .trim();
  return [fit(name), fit(fallback)].find((each) => AREA_NAME.test(each)) ?? "Area";
}
