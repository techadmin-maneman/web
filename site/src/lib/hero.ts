// The hero's posters: the home page's largest first paint, which shows until the footage plays. A phone gets the
// poster's upright centre, the frame its own cut of the film opens on (heroFootage.phoneVideo in content/site.ts).

import { getImage } from "astro:assets";
import { heroFootage } from "../content/site.ts";
import { isShown } from "./build.ts";
import { designImage } from "./images.ts";

/** The phone cut's frame: the film's 406 x 720 centre. */
export const PHONE_POSTER = { width: 406, height: 720 } as const;

export interface HeroPosters {
  readonly wide: string;
  readonly phone: string;
}

/** Each poster's URL, or undefined when the footage is not shown. */
export async function heroPosters(): Promise<HeroPosters | undefined> {
  if (!isShown(heroFootage)) return undefined;
  const src = designImage(heroFootage.poster);
  const [wide, phone] = await Promise.all([
    getImage({ src, format: "webp", width: 1440 }),
    getImage({ src, format: "webp", ...PHONE_POSTER, fit: "cover", position: "center" }),
  ]);
  return { wide: wide.src, phone: phone.src };
}
