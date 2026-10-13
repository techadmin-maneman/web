// What clients' photographs and cards may hold of R2 (src/policy/storage-share.ts;
// docs/decisions/0093-the-storage-meter.md): "keep the look at full size and pay for R2 beyond the free
// tier when it fills"; the meter "warns ops at 50% and 80% of the share, and R2's
// paid storage is accepted as the share fills".

import { describe, expect, it } from "vitest";
import {
  markReached,
  PHOTO_SHARE_BYTES,
  PHOTO_UPLOADS_PER_TECHNICIAN_DAILY,
  SHARE_BYTES,
} from "../../../src/policy/storage-share.ts";

const GB = 1e9;

describe("the photographs' share of R2", () => {
  it("is ADR 0039's 4 GB, which staging and production share between them", () => {
    expect(PHOTO_SHARE_BYTES).toBe(4 * GB);
    expect(SHARE_BYTES.staging + SHARE_BYTES.production).toBe(PHOTO_SHARE_BYTES);
    expect(SHARE_BYTES).toEqual({ local: 0.4 * GB, staging: 0.4 * GB, production: 3.6 * GB });
  });

  it("tells ops at half the share, at 80% of it, when it is full, and at each whole share past it", () => {
    const share = 4 * GB;
    expect(markReached(0, share)).toBeNull();
    expect(markReached(1.99 * GB, share)).toBeNull();
    expect(markReached(2 * GB, share)).toBe(50);
    expect(markReached(3.19 * GB, share)).toBe(50);
    expect(markReached(3.2 * GB, share)).toBe(80);
    expect(markReached(4 * GB, share)).toBe(100);
    expect(markReached(7.9 * GB, share)).toBe(100);
    expect(markReached(9 * GB, share)).toBe(200);
    expect(markReached(12 * GB, share)).toBe(300);
  });
});

describe("what is refused", () => {
  // docs/decisions/0194-the-build-on-workers-paid.md: no ceiling on what is held, only on how fast it is sent.
  it("is a phone's uploads past a day's work twice over: twelve visits, ten photographs and their copies, twice", () => {
    expect(PHOTO_UPLOADS_PER_TECHNICIAN_DAILY).toBe(480);
  });
});
