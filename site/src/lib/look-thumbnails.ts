// The try-on's look pictures, made small at build time and handed to the island.

import { getImage } from "astro:assets";
import { lookPictures } from "../content/site.ts";
import { designImage } from "./images.ts";

/** The thumbnails' URLs in the looks' order, or null until every look has a picture. */
export async function lookThumbnails(): Promise<string[] | null> {
  const pictures = lookPictures();
  if (pictures === null) return null;
  const thumbnails = await Promise.all(
    pictures.map((file) => getImage({ src: designImage(file), format: "webp", width: 480 })),
  );
  return thumbnails.map((thumbnail) => thumbnail.src);
}
