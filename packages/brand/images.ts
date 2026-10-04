// The brand's drawings as images, made at build time: a drawing from design/brand in the middle of a square or card of
// one of the brand's colours, as the kit's README asks for icons on a dark ground. The site's favicons, touch icon and
// link card, and the apps' home-screen icons, all come from here. The PNGs carry none of the source files' metadata.

import sharp from "sharp";

/** `svg` drawn `artWidth` wide in the middle of a `size` image of `ground`. */
export async function onGround(
  svg: string,
  size: { readonly width: number; readonly height: number },
  artWidth: number,
  ground: string,
): Promise<Uint8Array> {
  const art = await sharp(new TextEncoder().encode(svg), { density: 600 }).resize({ width: artWidth }).png().toBuffer();
  return sharp({ create: { ...size, channels: 4, background: ground } })
    .composite([{ input: art, gravity: "centre" }])
    .png()
    .toBuffer();
}

/**
 * A favicon.ico holding PNGs, which every browser since 2009 reads: a six-byte header, a sixteen-byte entry for each
 * image, then the images. A crawler or browser asks for /favicon.ico whatever the page links.
 */
export function icoOf(images: readonly { readonly size: number; readonly png: Uint8Array }[]): Uint8Array {
  const directory = 6 + 16 * images.length;
  const ico = new Uint8Array(directory + images.reduce((total, image) => total + image.png.length, 0));
  const view = new DataView(ico.buffer);
  view.setUint16(2, 1, true); // an icon, not a cursor
  view.setUint16(4, images.length, true);
  let offset = directory;
  images.forEach(({ size, png }, index) => {
    const entry = 6 + 16 * index;
    view.setUint8(entry, size >= 256 ? 0 : size); // width; 0 means 256
    view.setUint8(entry + 1, size >= 256 ? 0 : size); // height
    view.setUint16(entry + 4, 1, true); // colour planes
    view.setUint16(entry + 6, 32, true); // bits per pixel
    view.setUint32(entry + 8, png.length, true);
    view.setUint32(entry + 12, offset, true);
    ico.set(png, offset);
    offset += png.length;
  });
  return ico;
}
