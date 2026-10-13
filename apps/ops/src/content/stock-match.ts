// A client matched to stock, on their Pieces tab (docs/decisions/0173-matching-a-client-to-stock.md). Only that panel
// reads it, loaded when the tab opens.

const FIELDS: Readonly<Record<string, string>> = {
  product: "product",
  base_width_in: "base width",
  base_length_in: "base length",
  colour: "colour",
  grey_percent: "grey",
  density_percent: "density",
};

/** "grey and density", "colour, grey and density". */
function joined(words: readonly string[]): string {
  if (words.length < 2) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1) ?? ""}`;
}

export const stockMatch = {
  title: "Stock",
  noProfile: "No hair profile yet, so nothing to match.",
  /** "The profile needs grey and density to match stock." */
  incomplete: (missing: readonly string[]) =>
    `The profile needs ${joined(missing.map((field) => FIELDS[field] ?? field))} to match stock.`,
  custom: "No stocked hair system matches. Raise a custom order.",
  matched: (name: string) => `Matches ${name}.`,
  noneHeld: "None held yet.",
  /** "1 · Imran Qureshi, Gurgaon" */
  held: (pieces: number, place: string, city: string | null) =>
    `${String(pieces)} · ${city === null ? place : `${place}, ${city}`}`,
  inTransit: (pieces: number) => `${String(pieces)} on the way`,
};
