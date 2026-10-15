// How YouCam makes each look (docs/decisions/0201-the-try-on-on-youcam.md): from one reference photograph of ours,
// whose hair it puts on the visitor's photograph. The photographs are one synthetic man, final and tested; their bytes
// are checked against data/tryon-refs-v1.json. They are served at TRYON_REFS_URL, whose path ends in the version: a new
// photograph changes the look, so it goes under a new version, and the render cache keys on it. The domain names a
// look by its id alone (src/config/presets.ts); only this provider knows what makes it.

import type { PresetId } from "../../config/presets.ts";

export const REFERENCE_VERSION = "v1";

/** Each look's reference photograph, a file under TRYON_REFS_URL. */
export const YOUCAM_REFERENCES: Readonly<Record<PresetId, string>> = {
  "side-part": "side-part.jpg",
  "slick-back": "slick-back.jpg",
  "textured-crop": "textured-crop.jpg",
  "french-crop": "french-crop.jpg",
  quiff: "quiff.jpg",
  "crew-cut": "crew-cut.jpg",
};

/** Where YouCam fetches a look's reference photograph. */
export const referenceUrlOf = (refsUrl: string, look: PresetId): string => `${refsUrl}/${YOUCAM_REFERENCES[look]}`;
