// The QR reader's worker (packages/ui/qr-decoder.ts): a frame read is answered with what the worker found, and a worker
// that fails, as one whose file a release removed, rejects each read waiting on it and every read after.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { qrDecoder } from "../../../packages/ui/qr-decoder.ts";

class FakeWorker extends EventTarget {
  static made: FakeWorker[] = [];
  readonly asked: { id: number }[] = [];
  constructor() {
    super();
    FakeWorker.made.push(this);
  }
  postMessage(message: { id: number }) {
    this.asked.push(message);
  }
  terminate() {
    // Nothing runs to stop.
  }
  answer(id: number, data: string | null) {
    this.dispatchEvent(Object.assign(new Event("message"), { data: { id, type: "qrResult", data } }));
  }
  fail() {
    this.dispatchEvent(Object.assign(new Event("error"), { message: "404" }));
  }
}

const frame = () => ({ data: { buffer: new ArrayBuffer(4) } }) as unknown as ImageData;

beforeEach(() => {
  FakeWorker.made = [];
  vi.stubGlobal("Worker", FakeWorker);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the QR reader", () => {
  it("answers each frame with what its worker found", async () => {
    const decoder = qrDecoder();
    const reading = decoder.read(frame());
    FakeWorker.made[0]?.answer(1, "MM-U-0001");
    expect(await reading).toBe("MM-U-0001");
  });

  it("rejects the reads waiting on a worker that failed, and every read after", async () => {
    const decoder = qrDecoder();
    const reading = decoder.read(frame());
    FakeWorker.made[0]?.fail();
    await expect(reading).rejects.toThrow("did not start");
    await expect(decoder.read(frame())).rejects.toThrow("did not start");
    expect(FakeWorker.made[0]?.asked).toHaveLength(1);
  });
});
