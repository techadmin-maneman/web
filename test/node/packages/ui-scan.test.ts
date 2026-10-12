// The scanner's decoder reads the QR code a label prints (packages/ui/ScanField.tsx, packages/ui/scanned.ts,
// apps/ops/src/stock/LabelSheet.tsx; docs/decisions/0162-scanning-labels.md): black on white, as the label printer
// prints it, with the same settings.

import jsQR from "jsqr";
import { encode } from "uqr";
import { describe, expect, it } from "vitest";
import { scanned } from "../../../packages/ui/scanned.ts";

/** The QR code a label prints, as a camera frame: `scale` pixels to a module, black on white. */
function frameOf(text: string, scale: number): { pixels: Uint8ClampedArray; width: number } {
  const { data, size } = encode(text, { ecc: "M", border: 2 });
  const width = size * scale;
  const pixels = new Uint8ClampedArray(width * width * 4);
  for (let y = 0; y < width; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const shade = data[Math.floor(y / scale)]?.[Math.floor(x / scale)] === true ? 0 : 255;
      pixels.set([shade, shade, shade, 255], (y * width + x) * 4);
    }
  }
  return { pixels, width };
}

describe("a label's QR code", () => {
  it("reads back as the label it holds", () => {
    for (const label of ["MM-ESS-0000123-J", "MM-LT-0000001-B"]) {
      const { pixels, width } = frameOf(label, 4);
      expect(jsQR(pixels, width, width, { inversionAttempts: "dontInvert" })?.data).toBe(label);
    }
  });

  it("is taken trimmed and in capitals, as a hand types it", () => {
    expect(scanned("  mm-ess-0000123-j \n")).toBe("MM-ESS-0000123-J");
  });
});
