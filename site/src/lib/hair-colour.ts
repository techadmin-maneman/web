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

/** The hair colour in an RGBA image, already at most DETECTOR_SIDE pixels a side. */
export function detectHairColour(pixels: ArrayLike<number>, width: number, height: number): HairColor {
  const at = (x: number, y: number): Rgb => {
    const i = (y * width + x) * 4;
    return [pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0];
  };

  // 1. Skin, by its chroma: where the face is.
  const skin = new Uint8Array(width * height);
  const skinX: number[] = [];
  const skinY: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = at(x, y);
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      const cr = (r - luma) * 0.713 + 128;
      const cb = (b - luma) * 0.564 + 128;
      if (cr > 133 && cr < 180 && cb > 77 && cb < 128 && luma > 50) {
        skin[y * width + x] = 1;
        skinX.push(x);
        skinY.push(y);
      }
    }
  }
  if (skinY.length < 0.01 * width * height) return "unknown";

  // 2. The head: the top of the skin, and its width across the forehead.
  const top = percentile(skinY, 0.01);
  const foreheadX = skinX.filter((_, i) => (skinY[i] ?? 0) < top + 0.18 * height);
  if (foreheadX.length < 30) return "unknown";
  const left = percentile(foreheadX, 0.05);
  const right = percentile(foreheadX, 0.95);
  const faceWidth = Math.max(right - left, 8);
  const faceHeight = faceWidth * 1.35;
  const centre = (left + right) / 2;
  const chin = top + faceHeight;
  const inBox = (x: number, y: number, wide: number, tall: number) =>
    x > centre - faceWidth * wide &&
    x < centre + faceWidth * wide &&
    y > top - faceHeight * tall &&
    y < chin + faceHeight * 0.1;

  // 3. Scenery: colours common in a ring around the head, whatever they are.
  const bins = new Map<string, [number, number, number, number]>();
  let ringSize = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!inBox(x, y, 1.45, 0.85) || inBox(x, y, 0.8, 0.38)) continue;
      const [r, g, b] = at(x, y);
      ringSize++;
      const key = `${String(Math.floor(r / 22))},${String(Math.floor(g / 22))},${String(Math.floor(b / 22))}`;
      const bin = bins.get(key) ?? [0, 0, 0, 0];
      bin[0] += r;
      bin[1] += g;
      bin[2] += b;
      bin[3]++;
      bins.set(key, bin);
    }
  }
  const scenery: Rgb[] = [...bins.values()]
    .filter((bin) => bin[3] >= ringSize * 0.012)
    .map((bin) => [bin[0] / bin[3], bin[1] / bin[3], bin[2] / bin[3]]);

  const texture = (x: number, y: number) => {
    if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) return 0;
    const lum = (px: number, py: number) => {
      const [r, g, b] = at(px, py);
      return (r + g + b) / 3;
    };
    return Math.abs(lum(x + 1, y) - lum(x - 1, y)) + Math.abs(lum(x, y + 1) - lum(x, y - 1));
  };

  // 4. The median colour of a region, if it is textured and not scenery.
  const sample = (inRegion: (x: number, y: number) => boolean, mustBeTextured: boolean): Rgb | null => {
    const points: [number, number][] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (skin[y * width + x] === 0 && inBox(x, y, 0.8, 0.38) && inRegion(x, y)) points.push([x, y]);
      }
    }
    if (points.length < 40) return null;
    if (mustBeTextured && median(points.map(([x, y]) => texture(x, y))) < 5) return null;
    let colours = points.map(([x, y]) => at(x, y));
    if (scenery.length > 0) {
      colours = colours.filter((colour) => Math.min(...scenery.map((s) => distance(colour, s))) > 34);
    }
    if (colours.length < 40) return null;
    const middle = medianColour(colours);
    const near = colours.filter((colour) => distance(colour, middle) < 46);
    const [r, g, b] = medianColour(near.length > 20 ? near : colours);
    return [Math.round(r), Math.round(g), Math.round(b)];
  };

  const crown = (_x: number, y: number) => y > top - faceHeight * 0.3 && y < top + faceHeight * 0.06;
  const temples = (x: number, y: number) =>
    y > top + faceHeight * 0.1 &&
    y < top + faceHeight * 0.6 &&
    (x < left + faceWidth * 0.08 || x > right - faceWidth * 0.08);
  const brows = (x: number, y: number) =>
    y > top + faceHeight * 0.3 &&
    y < top + faceHeight * 0.46 &&
    x > left + faceWidth * 0.12 &&
    x < right - faceWidth * 0.12;

  const hair = sample((x, y) => crown(x, y) || temples(x, y), true) ?? sample(temples, true) ?? sample(brows, false);
  return hair === null ? "unknown" : apiColour(nearestShade(hair));
}
