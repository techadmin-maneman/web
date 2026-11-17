// The camera's reads (packages/ui/ScanField.tsx; docs/decisions/0271-the-technician-follow-ups.md): each frame read for a
// QR code until one is taken, which `onRead` is given once; a code `takes` refuses leaves it reading. The camera's stream
// and the decoder's worker are stand-ins: the decoder answers what the test lines up, a frame at a time.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lined: (string | null)[] = [];
let framesRead = 0;

vi.mock("../../packages/ui/useCamera.ts", () => ({
  useCamera: () => [{ state: "open", stream: {} }, () => undefined],
}));
vi.mock("../../packages/ui/qr-decoder.ts", () => ({
  qrDecoder: () => ({
    read: () => {
      framesRead += 1;
      return Promise.resolve(lined.shift() ?? null);
    },
    close: () => undefined,
  }),
}));

const { QrCamera } = await import("../../packages/ui/ScanField.tsx");

const WORDS = { opening: "Opening the camera…", refused: "No camera." };

let page: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  lined.length = 0;
  framesRead = 0;
  // A picture a frame's worth wide, playing, and a canvas that hands back a frame.
  Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: () => Promise.resolve() });
  Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { configurable: true, get: () => 640 });
  Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", { configurable: true, get: () => 480 });
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => ({ drawImage: () => undefined, getImageData: () => ({}) }),
  });
  page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  page.remove();
  vi.useRealTimers();
});

/** Lets the camera read `frames` frames, each after its wait. */
async function readFrames(frames: number): Promise<void> {
  for (let frame = 0; frame < frames; frame += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
  }
}

describe("the camera", () => {
  it("reads past a code it does not take, and gives the next it takes once, reading no more after", async () => {
    lined.push("MM-ESS-0000001-A", "MM-ESS-0000001-A", "MM-ESS-0000002-B", "MM-ESS-0000003-C");
    const read: string[] = [];
    act(() => {
      root.render(
        createElement(QrCamera, {
          words: WORDS,
          takes: (text: string) => text !== "MM-ESS-0000001-A",
          onRead: (text: string) => {
            read.push(text);
          },
        }),
      );
    });
    await readFrames(6);
    expect(read).toEqual(["MM-ESS-0000002-B"]);
    expect(framesRead).toBe(3);
  });

  it("takes the first code it reads where no screen says what it takes", async () => {
    lined.push(null, "MM-ESS-0000001-A", "MM-ESS-0000002-B");
    const read: string[] = [];
    act(() => {
      root.render(
        createElement(QrCamera, {
          words: WORDS,
          onRead: (text: string) => {
            read.push(text);
          },
        }),
      );
    });
    await readFrames(5);
    expect(read).toEqual(["MM-ESS-0000001-A"]);
  });
});
