// What clients' photographs and cards may hold of R2 (src/policy/storage-share.ts;
// docs/decisions/0093-the-storage-meter.md): "keep the look at full size and pay for R2 beyond the free
// tier when it fills"; the meter "warns ops at 50% and 80% of the share, and R2's
// paid storage is accepted as the share fills".

import { describe, expect, it } from "vitest";
import {
  hasRoom,
  markReached,
  PHASE_2_SHARE_BYTES,
  SHARE_BYTES,
  RUNAWAY_CEILING_BYTES,
} from "../../../src/policy/storage-share.ts";

const GB = 1e9;

describe("the photographs' share of R2", () => {
  it("is ADR 0039's 4 GB, which staging and production share between them", () => {
    expect(PHASE_2_SHARE_BYTES).toBe(4 * GB);
    expect(SHARE_BYTES.staging + SHARE_BYTES.production).toBe(PHASE_2_SHARE_BYTES);
    expect(SHARE_BYTES).toEqual({ local: 0.4 * GB, staging: 0.4 * GB, production: 3.6 * GB });
  });

  it("tells ops at half the share, at 80% of it, and again when it is full", () => {
    const share = 4 * GB;
    expect(markReached(0, share)).toBeNull();
    expect(markReached(1.99 * GB, share)).toBeNull();
    expect(markReached(2 * GB, share)).toBe(50);
    expect(markReached(3.19 * GB, share)).toBe(50);
    expect(markReached(3.2 * GB, share)).toBe(80);
    expect(markReached(4 * GB, share)).toBe(100);
    expect(markReached(9 * GB, share)).toBe(100);
  });
});

describe("what is refused", () => {
  it("is nothing for a full share: R2's paid storage is accepted", () => {
    expect(hasRoom(4 * GB, 250_000)).toBe(true);
    expect(hasRoom(12 * GB, 250_000)).toBe(true);
  });

  it("is a runaway, far past the share: twice R2's free 10 GB", () => {
    expect(RUNAWAY_CEILING_BYTES).toBe(20 * GB);
    expect(hasRoom(RUNAWAY_CEILING_BYTES - 250_000, 250_000)).toBe(true);
    expect(hasRoom(RUNAWAY_CEILING_BYTES - 250_000, 250_001)).toBe(false);
  });
});
