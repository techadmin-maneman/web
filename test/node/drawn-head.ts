// A drawn head, for testing the hair-colour detector without a photograph of
// anyone: a skin-coloured oval face on a plain wall, with hair of the given
// colour over the crown and down both sides. RGBA, 300 × 400.

export type Rgb = readonly [number, number, number];

export const HEAD_WIDTH = 300;
export const HEAD_HEIGHT = 400;
const WALL: Rgb = [200, 205, 210];
const SKIN: Rgb = [200, 150, 120];

/** A repeatable ±spread wobble, so hair has texture and the wall has grain. */
function noise(seed: number, spread: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return (state / 2 ** 31) * 2 * spread - spread;
  };
}

function wobbled([r, g, b]: Rgb, wobble: () => number): Rgb {
  return [r + wobble(), g + wobble(), b + wobble()];
}

/** No hair (null) draws a bare head against the wall. */
export function drawnHead(hair: Rgb | null): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(HEAD_WIDTH * HEAD_HEIGHT * 4);
  const grain = noise(1, 6);
  const strands = noise(2, 20);
  for (let y = 0; y < HEAD_HEIGHT; y++) {
    for (let x = 0; x < HEAD_WIDTH; x++) {
      const face = ((x - 150) / 60) ** 2 + ((y - 220) / 80) ** 2 <= 1;
      const crown = y >= 90 && y < 160 && x >= 70 && x < 230;
      const sides = y >= 160 && y < 200 && ((x >= 70 && x < 104) || (x >= 196 && x < 230));
      let colour: Rgb;
      if (face) colour = SKIN;
      else if (hair !== null && (crown || sides)) colour = wobbled(hair, strands);
      else colour = wobbled(WALL, grain);
      pixels.set([...colour, 255], (y * HEAD_WIDTH + x) * 4);
    }
  }
  return pixels;
}
