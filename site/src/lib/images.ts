// Images and footage by file name, as site.ts names them. Real material goes
// in site/src/assets; the design's placeholders stay in design/assets, which
// is read-only. A name in site/src/assets wins. Astro optimises every image
// into AVIF and WebP at build time.

import type { ImageMetadata } from "astro";

const IMAGES = {
  ...import.meta.glob<ImageMetadata>("../../../design/assets/*.jpg", { eager: true, import: "default" }),
  ...import.meta.glob<ImageMetadata>("../assets/*.{jpg,jpeg,png,webp}", { eager: true, import: "default" }),
};
const MEDIA = {
  ...import.meta.glob<string>("../../../design/assets/*.mp4", { eager: true, query: "?url", import: "default" }),
  ...import.meta.glob<string>("../assets/*.mp4", { eager: true, query: "?url", import: "default" }),
};

function find<T>(files: Record<string, T>, file: string): T {
  const found = files[`../assets/${file}`] ?? files[`../../../design/assets/${file}`];
  if (found === undefined) throw new Error(`${file} is in neither site/src/assets nor design/assets`);
  return found;
}

export function designImage(file: string): ImageMetadata {
  return find(IMAGES, file);
}

/** The built URL of a video. */
export function designMedia(file: string): string {
  return find(MEDIA, file);
}
