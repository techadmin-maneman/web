// The six looks the try-on offers: each a hairstyle, made from one reference photograph of ours, whose hair YouCam
// puts on the visitor's photograph (docs/decisions/0201-the-try-on-on-youcam.md). The photographs are one synthetic
// man, final and tested; their bytes are checked against data/tryon-refs-v1.json. They are served at
// TRYON_REFS_URL, whose path ends in REFERENCE_VERSION: a new photograph changes the look, so it goes under a new
// version, and the render cache keys on it.

export const REFERENCE_VERSION = "v1";

export interface Preset {
  readonly id: string;
  /** The look's name in the picker. */
  readonly label: string;
  /** The reference photograph's file under TRYON_REFS_URL. */
  readonly reference: string;
}

export const PRESETS = [
  { id: "side-part", label: "Side part", reference: "side-part.jpg" },
  { id: "slick-back", label: "Slick back", reference: "slick-back.jpg" },
  { id: "textured-crop", label: "Textured crop · Low fade", reference: "textured-crop.jpg" },
  { id: "french-crop", label: "French crop", reference: "french-crop.jpg" },
  { id: "quiff", label: "Quiff", reference: "quiff.jpg" },
  { id: "crew-cut", label: "Crew cut · Ivy League", reference: "crew-cut.jpg" },
] as const satisfies readonly Preset[];

export type PresetId = (typeof PRESETS)[number]["id"];
export const PRESET_IDS = PRESETS.map((preset) => preset.id) as [PresetId, ...PresetId[]];

export function findPreset(id: string): Preset | undefined {
  return PRESETS.find((preset) => preset.id === id);
}

/** Where YouCam fetches a look's reference photograph. */
export const referenceUrlOf = (refsUrl: string, preset: Preset): string => `${refsUrl}/${preset.reference}`;
