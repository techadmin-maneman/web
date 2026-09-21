// The six looks the design offers, and what each asks AILabTools for.
//
// PLACEHOLDERS. The hair styles are real catalog ids, chosen as rough matches
// for the design's wording; the preset bake-off replaces them. A test fails if
// any id is missing from data/ailabtools-catalog.json.
//
// Pro is the default: it keeps the face, while Premium visibly changed face
// shape in the harness's tests (docs/reference/ailabtools-api-notes.md, 7.7).

export type Endpoint = "pro" | "premium";

export interface Preset {
  readonly id: string;
  /** The design's words for the look. */
  readonly label: string;
  readonly endpoint: Endpoint;
  /** A male style id from the AILabTools catalog. */
  readonly hairStyle: string;
}

export const PRESETS = [
  {
    id: "full-natural-short",
    label: "Full density · Natural hairline · short",
    endpoint: "pro",
    hairStyle: "Natural_Side-Part",
  },
  {
    id: "full-straight-medium",
    label: "Full density · Straight hairline · medium",
    endpoint: "pro",
    hairStyle: "Side-Parted_Textured",
  },
  {
    id: "medium-natural-short",
    label: "Medium density · Natural hairline · short",
    endpoint: "pro",
    hairStyle: "Side-Part_Crop",
  },
  {
    id: "medium-receded-medium",
    label: "Medium density · Receded hairline · medium",
    endpoint: "pro",
    hairStyle: "CombOver",
  },
  {
    id: "light-natural-short",
    label: "Light density · Natural hairline · short",
    endpoint: "pro",
    hairStyle: "Smooth_Crop",
  },
  {
    id: "light-receded-cropped",
    label: "Light density · Receded hairline · cropped",
    endpoint: "pro",
    hairStyle: "BuzzCut",
  },
] as const satisfies readonly Preset[];

export type PresetId = (typeof PRESETS)[number]["id"];
export const PRESET_IDS = PRESETS.map((preset) => preset.id) as [PresetId, ...PresetId[]];

export function findPreset(id: string): Preset | undefined {
  return PRESETS.find((preset) => preset.id === id);
}
