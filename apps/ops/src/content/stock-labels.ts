// The Stock page's labels, and the pieces scanned by them (docs/decisions/0161-pieces-as-units.md,
// 0162-scanning-labels.md). No design draws them; every word here is ours. Only the Stock page reads it.

const pieces = (count: number) => `${String(count)} ${count === 1 ? "piece" : "pieces"}`;

export const stockLabels = {
  title: "Labels",
  item: "Item",
  place: "Place",
  unlabelled: (count: number) => `${pieces(count)} here without a label.`,
  labelThem: (count: number) => `Label ${pieces(count)}`,
  labelling: "Labelling…",
  notLabelled: "Those pieces weren’t labelled. Try again.",
  /** "Labelled 21 Sep, 12:00 · 3 pieces" */
  batch: (when: string, count: number) => `Labelled ${when} · ${pieces(count)}`,
  /** Said to a screen reader: the batches to print labels for. */
  batchesLegend: "Batches to print",
  noUnits: "No labelled pieces here.",
  print: (count: number) => `Print ${String(count)} ${count === 1 ? "label" : "labels"}`,
  printing: "Printing…",
  copies: "Copies",
  noLots: "No lots here to label.",
  lot: "Lot",
  expires: (date: string) => `Exp ${date}`,
  noLabel: "That label couldn’t be made. Try again.",
  scan: {
    label: "Label",
    add: "Add",
    camera: "Camera",
    stop: "Stop camera",
    opening: "Opening the camera…",
    refused: "No camera here. Type the label, or use a scanner.",
  },
  scanned: (count: number) => `${pieces(count)} scanned`,
  remove: "Remove",
  removeLabel: (label: string) => `Remove ${label}`,
  find: "Find a label",
  notFound: "No piece here has that label.",
  states: {
    held: "Held",
    in_transit: "In transit",
    fitted: "Fitted",
    returned: "Returned",
    written_off: "Write-off",
    missing: "Missing",
  },
  /** "Held · Imran Qureshi" */
  where: (state: string, place: string | null) => (place === null ? state : `${state} · ${place}`),
  history: "History",
};
