// The six looks the try-on offers, each a hairstyle by its id and its name in the picker. How a look is made is the
// image provider's own (src/providers/image/youcam-looks.ts): the domain asks for a look by its id, never for a
// vendor's catalog entry or reference.

export interface Preset {
  readonly id: string;
  /** The look's name in the picker. */
  readonly label: string;
}

export const PRESETS = [
  { id: "side-part", label: "Side part" },
  { id: "slick-back", label: "Slick back" },
  { id: "textured-crop", label: "Textured crop · Low fade" },
  { id: "french-crop", label: "French crop" },
  { id: "quiff", label: "Quiff" },
  { id: "crew-cut", label: "Crew cut · Ivy League" },
] as const satisfies readonly Preset[];

export type PresetId = (typeof PRESETS)[number]["id"];
export const PRESET_IDS = PRESETS.map((preset) => preset.id) as [PresetId, ...PresetId[]];

export function findPreset(id: string): (typeof PRESETS)[number] | undefined {
  return PRESETS.find((preset) => preset.id === id);
}
