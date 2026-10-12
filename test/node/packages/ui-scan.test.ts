// The scanner's decoder reads the QR code a label prints (packages/ui/qr-decoder.worker.js, packages/ui/scanned.ts,
// apps/ops/src/stock/LabelSheet.tsx; docs/decisions/0162-scanning-labels.md): black on white, as the label printer
// prints it, asked as the camera asks it.

import { encode } from "uqr";
import { beforeAll, describe, expect, it } from "vitest";
import { scanned } from "../../../packages/ui/scanned.ts";

interface Answer {
  readonly id: number;
  readonly type: string;
  readonly data: string | null;
}

const answers: Answer[] = [];
let ask: (message: { data: unknown }) => void;

beforeAll(async () => {
  // The worker's own global, as a browser gives it one.
  const worker = { postMessage: (answer: Answer) => answers.push(answer), onmessage: null };
  Object.assign(globalThis, { self: worker });
  await import("../../../packages/ui/qr-decoder.worker.js");
  ask = worker.onmessage as unknown as typeof ask;
});

/** The QR code a label prints, as a camera frame: `scale` pixels to a module, black on white. */
function frameOf(text: string, scale: number): { data: Uint8ClampedArray; width: number; height: number } {
  const { data, size } = encode(text, { ecc: "M", border: 2 });
  const width = size * scale;
  const pixels = new Uint8ClampedArray(width * width * 4);
  for (let y = 0; y < width; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const shade = data[Math.floor(y / scale)]?.[Math.floor(x / scale)] === true ? 0 : 255;
      pixels.set([shade, shade, shade, 255], (y * width + x) * 4);
    }
  }
  return { data: pixels, width, height: width };
}

describe("a label's QR code", () => {
  it("reads back as the label it holds, and a blank frame as nothing", () => {
    ask({ data: { id: 1, type: "decode", data: frameOf("MM-ESS-0000123-J", 4) } });
    ask({ data: { id: 2, type: "decode", data: frameOf("MM-LT-0000001-B", 3) } });
    const blank = new Uint8ClampedArray(120 * 120 * 4).fill(255);
    ask({ data: { id: 3, type: "decode", data: { data: blank, width: 120, height: 120 } } });
    expect(answers).toEqual([
      { id: 1, type: "qrResult", data: "MM-ESS-0000123-J", cornerPoints: expect.any(Array) as unknown },
      { id: 2, type: "qrResult", data: "MM-LT-0000001-B", cornerPoints: expect.any(Array) as unknown },
      { id: 3, type: "qrResult", data: null },
    ]);
  });

  it("is taken trimmed and in capitals, as a hand types it", () => {
    expect(scanned("  mm-ess-0000123-j \n")).toBe("MM-ESS-0000123-J");
  });
});
