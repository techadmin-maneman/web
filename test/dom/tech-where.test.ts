// Where the phone is (apps/tech/src/lib/where.ts; docs/decisions/0248-safety.md): a reading says when the phone took
// it, on the API's clock, not when it was sent; a phone that gives none answers null.

import { afterEach, describe, expect, it, vi } from "vitest";
import { heardFromApi } from "../../packages/web-kit/clock.ts";
import { readPosition } from "../../apps/tech/src/lib/where.ts";

/** A phone whose last fix was taken `ago` milliseconds before now. */
function phoneWithFix(ago: number): void {
  vi.stubGlobal("navigator", {
    geolocation: {
      getCurrentPosition: (found: PositionCallback) => {
        found({
          coords: { latitude: 28.3988, longitude: 77.07, accuracy: 12 },
          timestamp: Date.now() - ago,
        } as GeolocationPosition);
      },
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  heardFromApi(new Date().toUTCString());
});

describe("a reading of where the phone is", () => {
  it("says when the phone took it, which a quick reading may have kept minutes", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-20T10:00:00.000Z"), toFake: ["Date"] });
    phoneWithFix(4 * 60_000);
    expect(await readPosition("quick")).toEqual({
      lat: 28.3988,
      lng: 77.07,
      accuracy_m: 12,
      at: "2026-09-20T09:56:00.000Z",
    });
  });

  it("puts that time on the API's clock, for a phone whose own is out", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-20T10:00:00.000Z"), toFake: ["Date"] });
    // The API's clock reads ten minutes on from the phone's.
    heardFromApi("Sun, 20 Sep 2026 10:10:00 GMT");
    phoneWithFix(60_000);
    expect((await readPosition("close"))?.at).toBe("2026-09-20T10:09:00.000Z");
  });

  it("is null on a phone that gives none", async () => {
    vi.stubGlobal("navigator", {
      geolocation: {
        getCurrentPosition: (_found: PositionCallback, failed: PositionErrorCallback) => {
          failed({ code: 1 } as GeolocationPositionError);
        },
      },
    });
    expect(await readPosition()).toBeNull();
  });
});
