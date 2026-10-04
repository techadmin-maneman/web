// The images the brand kit asks for beyond the page itself, drawn at build
// time from design/brand: the card links show when shared (gilt lockup on
// ink, the kit's pairing for ink grounds), the favicons, favicon.ico, and the
// home-screen icons, each drawn on ink at the sizes the kit's README gives, by
// the apps' own helper (packages/brand/images.ts).

import { icoOf, onGround } from "@maneman/brand/images";
import favicon16 from "../../../design/brand/favicon-16.svg?raw";
import favicon from "../../../design/brand/favicon-32.svg?raw";
import lockup from "../../../design/brand/lockup-gilt.svg?raw";
import { colourOf } from "@maneman/brand/colours";
import tokens from "@maneman/brand/tokens.css?raw";

/** A colour from tokens.css, so the images use the site's one set of values. */
export function token(name: string): string {
  return colourOf(name, tokens);
}

const onInk = (svg: string, size: { width: number; height: number }, artWidth: number): Promise<Uint8Array> =>
  onGround(svg, size, artWidth, token("--ink"));

/** 1200 × 630, the size Open Graph and X cards use. */
export const OG_IMAGE = { width: 1200, height: 630 } as const;

export function openGraphImage(): Promise<Uint8Array> {
  return onInk(lockup, OG_IMAGE, 640);
}

export function appleTouchIcon(): Promise<Uint8Array> {
  return onInk(favicon, { width: 180, height: 180 }, 120);
}

/** The icons a manifest names, for "Add to Home screen": the drawing at two thirds of the width, as the touch icon's. */
export const HOME_SCREEN_SIZES = [192, 512] as const;
export type HomeScreenSize = (typeof HOME_SCREEN_SIZES)[number];

export function homeScreenIcon(size: HomeScreenSize): Promise<Uint8Array> {
  return onInk(favicon, { width: size, height: size }, Math.round((size * 2) / 3));
}

/** The browser tab's icon sizes. The 16 px one is the kit's silhouette cut: at 16 the crooks turn to mud. */
export const FAVICON_SIZES = [16, 32, 48] as const;
export type FaviconSize = (typeof FAVICON_SIZES)[number];

export function faviconImage(size: FaviconSize): Promise<Uint8Array> {
  const drawing = size === 16 ? favicon16 : favicon;
  return onInk(drawing, { width: size, height: size }, Math.round(size * 0.875));
}

/** The three favicons in one file, for the browsers and crawlers that ask for /favicon.ico whatever a page links. */
export async function faviconIco(): Promise<Uint8Array> {
  return icoOf(await Promise.all(FAVICON_SIZES.map(async (size) => ({ size, png: await faviconImage(size) }))));
}
