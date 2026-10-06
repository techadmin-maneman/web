// The referral card reaches people who have never heard of us, in WhatsApp,
// long after it was sent, so it is held to its design (design/phase2/Referral and
// Waitlist): a 2 px gilt rule, the gilt mark 44 × 48 and the wordmark's small
// cut 140 px wide in the bottom right corner. It was a 6 px rule in the brass
// meant for small text on paper, with no lockup.

import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { CARD_HEIGHT, CARD_WIDTH, HALF_WIDTH, LOCKUP, RULE_WIDTH } from "../../../apps/app/src/refer/card-layout.ts";
import { CARD_OVERLAY_PNG } from "../../../src/config/card-overlay.ts";

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

/** An image's pixel, as red, green, blue and alpha. */
async function pixels(bytes: Buffer) {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return (x: number, y: number) => {
    const at = (y * info.width + x) * info.channels;
    return [data[at] ?? 0, data[at + 1] ?? 0, data[at + 2] ?? 0, data[at + 3] ?? 0];
  };
}

const near = (rgb: number[], hex: string) =>
  rgb
    .slice(0, 3)
    .every((value, index) => Math.abs(value - Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16)) < 24);

describe("the overlay the API draws a client's card with", () => {
  const overlay = Buffer.from(CARD_OVERLAY_PNG, "base64");

  it("is clear over both photographs, with one gilt rule 2 px wide down the middle", async () => {
    expect(await sharp(overlay).metadata()).toMatchObject({ format: "png", width: CARD_WIDTH, height: CARD_HEIGHT });
    const pixel = await pixels(overlay);
    expect(HALF_WIDTH).toBe(599);
    expect(pixel(300, 315)[3]).toBe(0);
    expect(pixel(900, 315)[3]).toBe(0);
    for (const x of [HALF_WIDTH, HALF_WIDTH + RULE_WIDTH - 1]) {
      expect(near(pixel(x, 315), COLOURS.gilt)).toBe(true);
      expect(pixel(x, 315)[3]).toBe(255);
    }
  });

  it("carries the gilt mark and the paper wordmark in the bottom right corner", async () => {
    const pixel = await pixels(overlay);
    const anyIn = (left: number, top: number, width: number, height: number, hex: string) =>
      Array.from({ length: width * height }, (_, index) =>
        pixel(left + (index % width), top + Math.floor(index / width)),
      ).some((rgba) => near(rgba, hex) && rgba[3] === 255);
    // 1200 − 40 − (44 + 18 + 140) = 958 across, and 630 − 34 − 48 = 548 down; the wordmark centred on the mark's line.
    expect(anyIn(958, 548, 44, 48, COLOURS.gilt)).toBe(true);
    expect(anyIn(1020, 560, 140, 23, COLOURS.paper)).toBe(true);
    expect(LOCKUP).toMatchObject({ right: 40, bottom: 34, gap: 18 });
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
