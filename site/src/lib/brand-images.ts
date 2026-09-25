// The images the brand kit asks for beyond the page itself, drawn at build
// time from design/brand: the card links show when shared (gilt lockup on
// ink, the kit's pairing for ink grounds), and the favicons and the Apple
// touch icon, each drawn on ink at the sizes the kit's README gives. The
// PNGs carry none of the source files' metadata.

import sharp from "sharp";
import favicon16 from "../../../design/brand/favicon-16.svg?raw";
import favicon from "../../../design/brand/favicon-32.svg?raw";
import lockup from "../../../design/brand/lockup-gilt.svg?raw";
import tokens from "@maneman/brand/tokens.css?raw";

/** A colour from tokens.css, so the images use the site's one set of values. */
export function token(name: string): string {
  const found = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(tokens);
  if (found?.[1] === undefined) throw new Error(`no colour ${name} in tokens.css`);
  return found[1];
}

async function onInk(svg: string, size: { width: number; height: number }, artWidth: number): Promise<Buffer> {
  const art = await sharp(Buffer.from(svg), { density: 600 }).resize({ width: artWidth }).png().toBuffer();
  return sharp({ create: { ...size, channels: 4, background: token("--ink") } })
    .composite([{ input: art, gravity: "centre" }])
    .png()
    .toBuffer();
}

/** 1200 × 630, the size Open Graph and X cards use. */
export const OG_IMAGE = { width: 1200, height: 630 } as const;

export function openGraphImage(): Promise<Buffer> {
  return onInk(lockup, OG_IMAGE, 640);
}

export function appleTouchIcon(): Promise<Buffer> {
  return onInk(favicon, { width: 180, height: 180 }, 120);
}

/** The browser tab's icon sizes. The 16 px one is the kit's silhouette cut: at 16 the crooks turn to mud. */
export const FAVICON_SIZES = [16, 32, 48] as const;
export type FaviconSize = (typeof FAVICON_SIZES)[number];

export function faviconImage(size: FaviconSize): Promise<Buffer> {
  const drawing = size === 16 ? favicon16 : favicon;
  return onInk(drawing, { width: size, height: size }, Math.round(size * 0.875));
}
