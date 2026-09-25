// The referral card reaches people who have never heard of us, in WhatsApp,
// long after it was sent, so it is held to board A1 (design/phase2/Referral and
// Waitlist): a 2 px gilt rule, the gilt mark 44 × 48 and the wordmark's small
// cut 140 px wide in the bottom right corner. It was a 6 px rule in the brass
// meant for small text on paper, with no lockup (DS-01).

import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { drawCard } from "../../apps/app/src/refer/card-draw.ts";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  HALF_WIDTH,
  LOCKUP,
  RULE_WIDTH,
  viewBoxOf,
} from "../../apps/app/src/refer/card-layout.ts";
import { MARK, WORDMARK_SMALL } from "../../packages/brand/marks.ts";

const BOARD = readFileSync("design/phase2/Referral and Waitlist.dc.html", "utf8");
const A1 = BOARD.slice(BOARD.indexOf("A1 · Personal"), BOARD.indexOf("A2 · House sample"));
const TOKENS = readFileSync("packages/brand/tokens.css", "utf8");
const token = (name: string) => new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "i").exec(TOKENS)?.[1]?.toLowerCase() ?? "";
const COLOURS = { ink: token("--ink"), gilt: token("--gilt"), paper: token("--paper") };

describe("board A1", () => {
  it("draws the rule, the mark and the wordmark as the card's layout has them", () => {
    expect(A1).toContain(`width:${String(RULE_WIDTH)}px; background:#C9A363`);
    expect(A1).toContain(`right:${String(LOCKUP.right)}px; bottom:${String(LOCKUP.bottom)}px`);
    expect(A1).toContain(`gap:${String(LOCKUP.gap)}px`);
    expect(A1).toContain(`width="${String(LOCKUP.mark.width)}" height="${String(LOCKUP.mark.height)}" fill="#C9A363"`);
    expect(A1).toContain(
      `width="${String(LOCKUP.wordmark.width)}" height="${String(LOCKUP.wordmark.height)}" fill="#E9E4D8"`,
    );
    expect([COLOURS.gilt, COLOURS.paper]).toEqual(["#c9a363", "#e9e4d8"]);
  });
});

/** A canvas that writes down what is drawn on it, and in what colour. */
function recorder() {
  const drawn: string[] = [];
  let fillStyle = "";
  let origin = { x: 0, y: 0, scale: 1 };
  const context = {
    set fillStyle(value: string) {
      fillStyle = value;
    },
    fillRect: (x: number, y: number, width: number, height: number) =>
      drawn.push(`rect ${fillStyle} ${String([x, y, width, height])}`),
    save: () => undefined,
    restore: () => {
      origin = { x: 0, y: 0, scale: 1 };
    },
    beginPath: () => undefined,
    rect: () => undefined,
    clip: () => undefined,
    drawImage: () => drawn.push("photo"),
    translate: (x: number, y: number) => {
      origin = { ...origin, x: origin.x + x * origin.scale, y: origin.y + y * origin.scale };
    },
    scale: (by: number) => {
      origin = { ...origin, scale: origin.scale * by };
    },
    fill: (path: string, rule: string) =>
      drawn.push(
        `${path} ${fillStyle} ${rule} at ${origin.x.toFixed(1)},${origin.y.toFixed(1)} x${origin.scale.toFixed(3)}`,
      ),
  };
  return { context: context as unknown as CanvasRenderingContext2D, drawn };
}

describe("the card the phone composes", () => {
  it("puts one gilt rule 2 px wide down the middle, and the lockup in the bottom right corner", () => {
    const { context, drawn } = recorder();
    const photo = { width: 600, height: 800 } as unknown as ImageBitmap;
    drawCard(
      context,
      { before: photo, after: photo },
      {
        mark: "mark" as unknown as Path2D,
        markBox: viewBoxOf(MARK.viewBox),
        wordmark: "wordmark" as unknown as Path2D,
        wordmarkBox: viewBoxOf(WORDMARK_SMALL.viewBox),
      },
      COLOURS,
    );
    expect(HALF_WIDTH).toBe(599);
    expect(drawn).toEqual([
      `rect ${COLOURS.ink} 0,0,${String(CARD_WIDTH)},${String(CARD_HEIGHT)}`,
      "photo",
      "photo",
      `rect ${COLOURS.gilt} 599,0,2,630`,
      // 1200 − 40 − (44 + 18 + 140) = 958 across, and 630 − 34 − 48 = 548 down, as an SVG sets it: whole and centred.
      `mark ${COLOURS.gilt} evenodd at 958.0,548.1 x0.220`,
      // 958 + 44 + 18 = 1020 across and centred on the mark's line; its box starts 3 units left of and above it.
      `wordmark ${COLOURS.paper} nonzero at 1021.4,561.2 x0.217`,
    ]);
  });
});

describe("the house card", () => {
  const site = readFileSync("site/public/images/invite-house.jpg");

  it("is the same file on the site's invite and in the app's preview", () => {
    expect(readFileSync("apps/app/src/refer/invite-house.jpg").equals(site)).toBe(true);
  });

  it("is a 1200 x 630 JPEG under WhatsApp's 300 KB, with the gilt rule and the lockup of board A1", async () => {
    const image = sharp(site);
    expect(await image.metadata()).toMatchObject({ format: "jpeg", width: 1200, height: 630 });
    expect(site.byteLength).toBeLessThan(300 * 1024);
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => {
      const at = (y * info.width + x) * info.channels;
      return [data[at] ?? 0, data[at + 1] ?? 0, data[at + 2] ?? 0];
    };
    const near = (rgb: number[], hex: string) =>
      rgb.every((value, index) => Math.abs(value - Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16)) < 24);
    expect(near(pixel(599, 315), COLOURS.gilt)).toBe(true);
    expect(near(pixel(600, 315), COLOURS.gilt)).toBe(true);
    // Somewhere in the mark's box, gilt; somewhere in the wordmark's, paper.
    const anyIn = (left: number, top: number, width: number, height: number, hex: string) =>
      Array.from({ length: width * height }, (_, index) =>
        pixel(left + (index % width), top + Math.floor(index / width)),
      ).some((rgb) => near(rgb, hex));
    expect(anyIn(958, 548, 44, 48, COLOURS.gilt)).toBe(true);
    expect(anyIn(1020, 560, 140, 23, COLOURS.paper)).toBe(true);
  });
});
