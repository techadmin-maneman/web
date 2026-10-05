// Reads the visitor's hair colour from their photograph, in the browser. A
// port of the AILabTools harness's detector (its cloudflare/public/index.html):
// skin finds the head, texture proves a patch is hair rather than a wall or a
// bare scalp, and colours common in a ring around the head are scenery. The
// median of what is left is matched against the harness's natural palette.
//
// The API takes six shades. Anything else the palette finds (blonde, red…),
// or a photograph it cannot read, is `unknown`, which the backend renders as
// UNKNOWN_COLOR_ROUTE says.

import type { HairColor } from "../../../src/config/tryon.ts";

type Rgb = readonly [number, number, number];

/** The harness catalogue's natural shades (cloudflare/public/catalog.json), as sRGB. */
const PALETTE: Readonly<Record<string, Rgb>> = {
  black: [20, 19, 17],
  brown: [49, 37, 29],
  lightBrown: [129, 86, 55],
  blonde: [186, 160, 136],
  platinumBlonde: [185, 165, 149],
  grey: [114, 109, 105],
  silver: [172, 160, 150],
  white: [217, 212, 208],
  red: [113, 22, 17],
  burgundy: [60, 19, 21],
};

const ACCEPTED: readonly HairColor[] = ["black", "brown", "lightBrown", "grey", "silver", "white"];

/** The detector works on a copy at most this many pixels on its longer side. */
export const DETECTOR_SIDE = 420;

/**
 * The detector's limits, as the harness tuned them. Lengths about the head are in faces: a share of the face's width
 * across, and of its height up and down.
 */
const LIMITS = {
  /** Skin's chroma in YCbCr, between these, in at least this much light. */
  skinCr: [133, 180],
  skinCb: [77, 128],
  skinLuma: 50,
  /** Less skin than this share of the image is no face. */
  leastSkin: 0.01,
  /** The skin's top, past a stray pixel; and the forehead's edges, past a stray few. */
  topPercentile: 0.01,
  edgePercentiles: [0.05, 0.95],
  /** The forehead is the skin this deep below its top, as a share of the image's height, and needs this many pixels. */
  foreheadDepth: 0.18,
  leastForehead: 30,
  narrowestFace: 8,
  /** A face's height to its width. */
  faceHeight: 1.35,
  /** The head's box, either side of the face's centre and above its top; it ends this far below the chin. */
  head: { wide: 0.8, tall: 0.38 },
  belowChin: 0.1,
  /** The ring is between the head's box and this wider, taller one. */
  ring: { wide: 1.45, tall: 0.85 },
  /** Scenery: colours binned this many levels to a channel, common in at least this share of the ring. */
  binLevels: 22,
  sceneryShare: 0.012,
  /** A region is read from this many pixels at least, and is hair only with at least this median texture. */
  leastPoints: 40,
  leastTexture: 5,
  /** A pixel is scenery nearer than this to a scenery colour; near the region's median within this. RGB distance. */
  sceneryDistance: 34,
  nearMedian: 46,
  /** Fewer near the median than this, and the median of the whole region is taken instead. */
  leastNear: 20,
} as const;

/** Where hair is looked for, in faces from the top of the skin; each is tried in turn. */
const REGIONS = {
  /** Above the forehead, and a little into it. */
  crown: { from: -0.3, to: 0.06 },
  /** Down the sides of the face, within this of its edges. */
  temples: { from: 0.1, to: 0.6, edge: 0.08 },
  /** The eyebrows, this far in from the face's edges: the last resort, not proved by texture. */
  brows: { from: 0.3, to: 0.46, inset: 0.12 },
} as const;

/** CIE L*a*b* for an sRGB colour, so distances follow what the eye sees. */
function lab([r, g, b]: Rgb): Rgb {
  const linear = (v: number) => {
    const c = v / 255;
    return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92;
  };
  const [R, G, B] = [linear(r), linear(g), linear(b)];
  const f = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
  const y = f(0.2126 * R + 0.7152 * G + 0.0722 * B);
  const z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** The palette shade nearest to a colour. */
export function nearestShade(rgb: Rgb): string {
  const target = lab(rgb);
  let best = "black";
  let bestDistance = Infinity;
  for (const [name, colour] of Object.entries(PALETTE)) {
    const distance = lab(colour).reduce((sum, value, i) => sum + (value - (target[i] ?? 0)) ** 2, 0);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = name;
    }
  }
  return best;
}

/** The API's colour for a palette shade: one of its six, or unknown. */
export function apiColour(shade: string): HairColor {
  return ACCEPTED.find((colour) => colour === shade) ?? "unknown";
}

function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(p * (sorted.length - 1))] ?? 0;
}

function median(values: number[]): number {
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)] ?? 0;
}

const distance = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The median of each channel. */
function medianColour(colours: readonly Rgb[]): Rgb {
  return [median(colours.map((c) => c[0])), median(colours.map((c) => c[1])), median(colours.map((c) => c[2]))];
}

/** An RGBA image, read a pixel at a time. */
interface Image {
  readonly width: number;
  readonly height: number;
  readonly at: (x: number, y: number) => Rgb;
}

/** Where the skin is, a pixel at a time, and the skin's pixels by their x and y. */
interface Skin {
  readonly mask: Uint8Array;
  readonly xs: readonly number[];
  readonly ys: readonly number[];
}

/** The face, from the top of the skin and the forehead's width. */
interface Head {
  readonly top: number;
  readonly left: number;
  readonly right: number;
  readonly centre: number;
  readonly chin: number;
  readonly faceWidth: number;
  readonly faceHeight: number;
}

/** A box about the head, so many faces either side of its centre and above its top. */
type Box = { readonly wide: number; readonly tall: number };

/** Step 1. Skin, by its chroma: where the face is. */
function findSkin({ width, height, at }: Image): Skin {
  const mask = new Uint8Array(width * height);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = at(x, y);
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      const cr = (r - luma) * 0.713 + 128;
      const cb = (b - luma) * 0.564 + 128;
      const [crLow, crHigh] = LIMITS.skinCr;
      const [cbLow, cbHigh] = LIMITS.skinCb;
      if (cr > crLow && cr < crHigh && cb > cbLow && cb < cbHigh && luma > LIMITS.skinLuma) {
        mask[y * width + x] = 1;
        xs.push(x);
        ys.push(y);
      }
    }
  }
  return { mask, xs, ys };
}

/** Step 2. The head: the top of the skin, and its width across the forehead; null where there is no face to read. */
function findHead(skin: Skin, { width, height }: Image): Head | null {
  if (skin.ys.length < LIMITS.leastSkin * width * height) return null;
  const top = percentile(skin.ys, LIMITS.topPercentile);
  const foreheadX = skin.xs.filter((_, i) => (skin.ys[i] ?? 0) < top + LIMITS.foreheadDepth * height);
  if (foreheadX.length < LIMITS.leastForehead) return null;
  const left = percentile(foreheadX, LIMITS.edgePercentiles[0]);
  const right = percentile(foreheadX, LIMITS.edgePercentiles[1]);
  const faceWidth = Math.max(right - left, LIMITS.narrowestFace);
  const faceHeight = faceWidth * LIMITS.faceHeight;
  return { top, left, right, centre: (left + right) / 2, chin: top + faceHeight, faceWidth, faceHeight };
}

function inBox(head: Head, box: Box, x: number, y: number): boolean {
  return (
    x > head.centre - head.faceWidth * box.wide &&
    x < head.centre + head.faceWidth * box.wide &&
    y > head.top - head.faceHeight * box.tall &&
    y < head.chin + head.faceHeight * LIMITS.belowChin
  );
}

/** Step 3. Scenery: colours common in a ring around the head, whatever they are. */
function sceneryAround(image: Image, head: Head): Rgb[] {
  const bins = new Map<string, [number, number, number, number]>();
  let ringSize = 0;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (!inBox(head, LIMITS.ring, x, y) || inBox(head, LIMITS.head, x, y)) continue;
      const [r, g, b] = image.at(x, y);
      ringSize++;
      const level = (value: number) => String(Math.floor(value / LIMITS.binLevels));
      const key = `${level(r)},${level(g)},${level(b)}`;
      const bin = bins.get(key) ?? [0, 0, 0, 0];
      bin[0] += r;
      bin[1] += g;
      bin[2] += b;
      bin[3]++;
      bins.set(key, bin);
    }
  }
  return [...bins.values()]
    .filter((bin) => bin[3] >= ringSize * LIMITS.sceneryShare)
    .map((bin) => [bin[0] / bin[3], bin[1] / bin[3], bin[2] / bin[3]]);
}

/** How much a pixel's brightness changes across and down it: hair is busy, a wall or a bare scalp is not. */
function texture({ width, height, at }: Image, x: number, y: number): number {
  if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) return 0;
  const lum = (px: number, py: number) => {
    const [r, g, b] = at(px, py);
    return (r + g + b) / 3;
  };
  return Math.abs(lum(x + 1, y) - lum(x - 1, y)) + Math.abs(lum(x, y + 1) - lum(x, y - 1));
}

/** Step 4. The median colour of a region in the head's box, if it is textured where it must be, and not scenery. */
function sample(
  image: Image,
  skin: Skin,
  head: Head,
  scenery: readonly Rgb[],
  inRegion: (x: number, y: number) => boolean,
  mustBeTextured: boolean,
): Rgb | null {
  const points: [number, number][] = [];
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (skin.mask[y * image.width + x] === 0 && inBox(head, LIMITS.head, x, y) && inRegion(x, y)) {
        points.push([x, y]);
      }
    }
  }
  if (points.length < LIMITS.leastPoints) return null;
  if (mustBeTextured && median(points.map(([x, y]) => texture(image, x, y))) < LIMITS.leastTexture) return null;
  let colours = points.map(([x, y]) => image.at(x, y));
  if (scenery.length > 0) {
    colours = colours.filter((colour) => Math.min(...scenery.map((s) => distance(colour, s))) > LIMITS.sceneryDistance);
  }
  if (colours.length < LIMITS.leastPoints) return null;
  const middle = medianColour(colours);
  const near = colours.filter((colour) => distance(colour, middle) < LIMITS.nearMedian);
  const [r, g, b] = medianColour(near.length > LIMITS.leastNear ? near : colours);
  return [Math.round(r), Math.round(g), Math.round(b)];
}

/** The hair colour in an RGBA image, already at most DETECTOR_SIDE pixels a side. */
export function detectHairColour(pixels: ArrayLike<number>, width: number, height: number): HairColor {
  const image: Image = {
    width,
    height,
    at: (x, y) => {
      const i = (y * width + x) * 4;
      return [pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0];
    },
  };
  const skin = findSkin(image);
  const head = findHead(skin, image);
  if (head === null) return "unknown";
  const scenery = sceneryAround(image, head);

  const { top, left, right, faceWidth, faceHeight } = head;
  const { crown, temples, brows } = REGIONS;
  const between = (y: number, region: { from: number; to: number }) =>
    y > top + faceHeight * region.from && y < top + faceHeight * region.to;
  const onCrown = (_x: number, y: number) => between(y, crown);
  const onTemples = (x: number, y: number) =>
    between(y, temples) && (x < left + faceWidth * temples.edge || x > right - faceWidth * temples.edge);
  const onBrows = (x: number, y: number) =>
    between(y, brows) && x > left + faceWidth * brows.inset && x < right - faceWidth * brows.inset;

  const hairIn = (inRegion: (x: number, y: number) => boolean, mustBeTextured: boolean) =>
    sample(image, skin, head, scenery, inRegion, mustBeTextured);
  const hair =
    hairIn((x, y) => onCrown(x, y) || onTemples(x, y), true) ?? hairIn(onTemples, true) ?? hairIn(onBrows, false);
  return hair === null ? "unknown" : apiColour(nearestShade(hair));
}
