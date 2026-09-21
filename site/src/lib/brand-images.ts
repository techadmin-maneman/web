// The images the brand kit asks for beyond the page itself, drawn at build
// time from design/brand: the card links show when shared (gilt lockup on
// ink, the kit's pairing for ink grounds) and the Apple touch icon (the
// favicon drawing on ink, at 180 px, as the kit's README says).

import sharp from "sharp";
import favicon from "../../../design/brand/favicon-32.svg?raw";
import lockup from "../../../design/brand/lockup-gilt.svg?raw";
import tokens from "../styles/tokens.css?raw";

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
