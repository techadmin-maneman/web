// The brand's drawings as images (packages/brand/images.ts): the favicon.ico the site serves holds its PNGs as the
// ICO format lays them out, which every browser reads.

import { describe, expect, it } from "vitest";
import { icoOf, onGround } from "../../packages/brand/images.ts";

const SQUARE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#fff"/></svg>';

describe("icoOf", () => {
  it("lays out a header, an entry for each image, then the images where the entries say", async () => {
    const images = await Promise.all(
      [16, 32].map(async (size) => ({
        size,
        png: await onGround(SQUARE, { width: size, height: size }, 8, "#16233a"),
      })),
    );
    const ico = icoOf(images);
    const view = new DataView(ico.buffer, ico.byteOffset, ico.byteLength);

    expect([view.getUint16(0, true), view.getUint16(2, true), view.getUint16(4, true)]).toEqual([0, 1, 2]);
    images.forEach(({ size, png }, index) => {
      const entry = 6 + 16 * index;
      expect([view.getUint8(entry), view.getUint8(entry + 1)]).toEqual([size, size]);
      expect(view.getUint32(entry + 8, true)).toBe(png.length);
      const offset = view.getUint32(entry + 12, true);
      expect(ico.slice(offset, offset + png.length)).toEqual(new Uint8Array(png));
    });
    expect(ico.length).toBe(6 + 32 + images[0].png.length + images[1].png.length);
  });
});
