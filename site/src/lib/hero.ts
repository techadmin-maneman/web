// The hero poster: the home page's largest first paint, so the page preloads
// it and the video shows it until the footage plays.

import { getImage } from "astro:assets";
import { heroFootage } from "../content/site.ts";
import { isShown } from "./build.ts";
import { designImage } from "./images.ts";

/** The poster's URL, or undefined when the footage is not shown. */
export async function heroPosterUrl(): Promise<string | undefined> {
  if (!isShown(heroFootage)) return undefined;
  const poster = await getImage({ src: designImage(heroFootage.poster), format: "webp", width: 1440 });
  return poster.src;
}
