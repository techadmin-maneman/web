// What a render asks AILabTools for: the endpoint and the colour.
//
// A detected colour is sent as it is; Pro needs one, because it has no "keep
// the colour" option and defaults to blonde (API notes, 7.5). When the browser
// cannot read the hair, UNKNOWN_COLOR_ROUTE decides:
//   premium_original  Premium with color=original: the right colour, a less faithful face (7.7)
//   pro_black         Pro with black: the faithful face, the most likely colour

import type { LossExtent } from "../../config/booking.ts";
import type { Preset } from "../../config/presets.ts";
import type { HairColor, UnknownColorRoute } from "../../config/tryon.ts";
import type { RenderChoice } from "./tryon.ts";

export function chooseRender(
  stage: LossExtent,
  preset: Preset,
  hairColor: HairColor,
  unknownColorRoute: UnknownColorRoute,
): RenderChoice {
  const base = { stage, preset: preset.id, hairColor };
  if (hairColor !== "unknown") {
    return { ...base, endpoint: preset.endpoint, providerColor: hairColor, colorRoute: "as_detected" };
  }
  if (unknownColorRoute === "premium_original") {
    return { ...base, endpoint: "premium", providerColor: "original", colorRoute: "premium_original" };
  }
  return { ...base, endpoint: "pro", providerColor: "black", colorRoute: "pro_black" };
}
