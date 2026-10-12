// The Stock page's labels (docs/decisions/0161-pieces-as-units.md). No design draws them; every word here is ours.
// Only the Labels panel reads it, loaded when the page opens it.

const pieces = (count: number) => `${String(count)} ${count === 1 ? "piece" : "pieces"}`;

export const stockLabels = {
  title: "Labels",
  item: "Item",
  place: "Place",
  unlabelled: (count: number) => `${pieces(count)} here without a label.`,
  labelThem: (count: number) => `Label ${pieces(count)}`,
  labelling: "Labelling…",
  notLabelled: "Those pieces weren't labelled. Try again.",
  /** "Labelled 21 Sep, 12:00 · 3 pieces" */
  batch: (when: string, count: number) => `Labelled ${when} · ${pieces(count)}`,
  noUnits: "No labelled pieces here.",
  print: (count: number) => `Print ${String(count)} ${count === 1 ? "label" : "labels"}`,
  printing: "Printing…",
  copies: "Copies",
  noLots: "No lots here to label.",
  lot: "Lot",
  expires: (date: string) => `Exp ${date}`,
  noLabel: "That label couldn't be made. Try again.",
};
