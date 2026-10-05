import { describe, expect, it } from "vitest";
import { cappedBody } from "../../../src/http/capped-body.ts";

/** A body sent in chunks of `size` bytes, `count` of them, with no length declared; counts the chunks read. */
function streamed(count: number, size: number) {
  const sent = { chunks: 0, cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent.chunks === count) {
        controller.close();
        return;
      }
      sent.chunks += 1;
      controller.enqueue(new Uint8Array(size).fill(sent.chunks));
    },
    cancel() {
      sent.cancelled = true;
    },
  });
  return { request: new Request("https://example.com/", { method: "PUT", body }), sent };
}

describe("cappedBody", () => {
  it("reads a body up to the cap, in order", async () => {
    const { request } = streamed(3, 4);
    expect(await cappedBody(request, 12)).toEqual(Uint8Array.from([1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3]));
  });

  it("refuses a body declared longer than the cap without reading it", async () => {
    const request = new Request("https://example.com/", {
      method: "PUT",
      headers: { "Content-Length": "13" },
      body: new Uint8Array(13),
    });
    expect(await cappedBody(request, 12)).toBeNull();
    expect(request.bodyUsed).toBe(false);
  });

  // A sender may leave the length out, or understate it: the bytes are counted as they arrive.
  it("stops reading a body sent without its length once it passes the cap", async () => {
    const { request, sent } = streamed(1000, 1024);
    expect(await cappedBody(request, 4 * 1024)).toBeNull();
    expect(sent.chunks).toBeLessThan(10);
    expect(sent.cancelled).toBe(true);
  });

  it("reads no body as empty", async () => {
    expect(await cappedBody(new Request("https://example.com/", { method: "PUT" }), 12)).toEqual(new Uint8Array(0));
  });
});
