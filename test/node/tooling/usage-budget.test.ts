// What R2 costs a month at the committed ceilings, with the share set aside for clients' photographs and referral cards,
// held to its budget: raising a ceiling past it fails here (docs/decisions/0194-the-build-on-workers-paid.md).

import { describe, expect, it } from "vitest";
import {
  KEPT_TRY_ON_BYTES,
  monthlyCostUsd,
  overBudget,
  PHOTO_ALLOWANCE,
  photoRunwayVisits,
  R2_FREE_ALLOWANCE,
  worstCaseUsage,
  type Ceilings,
} from "../../../scripts/lib/usage-budget.ts";
import { MAX_COPY_BYTES, MAX_RESULT_BYTES } from "../../../src/config/tryon.ts";
import { PHOTO_SHARE_BYTES } from "../../../src/policy/storage-share.ts";
import { readJsonc } from "../../../scripts/lib/jsonc.ts";

function ceilingsOf(environment: "staging" | "production"): Ceilings {
  const config = readJsonc("wrangler.jsonc") as { env: Record<string, { vars: Record<string, string> }> };
  const vars = config.env[environment]?.vars ?? {};
  const number = (name: string) => {
    const value = Number(vars[name]);
    if (!Number.isInteger(value)) throw new Error(`${environment}: ${name} is not set`);
    return value;
  };
  return {
    renderDaily: number("RENDER_DAILY_CEILING"),
    uploadDaily: number("UPLOAD_DAILY_CEILING"),
    resultReadDaily: number("RESULT_READ_DAILY_CEILING"),
    resultRetentionDays: number("RESULT_RETENTION_DAYS"),
  };
}

const committed = [ceilingsOf("staging"), ceilingsOf("production")];

describe("R2's budget", () => {
  it("costs nothing at the committed ceilings, staging and production together, with the photographs' share", () => {
    expect(monthlyCostUsd(worstCaseUsage(committed))).toBe(0);
    expect(overBudget(worstCaseUsage(committed))).toEqual([]);
  });

  it("costs a few cents a month if the try-on kept its results for thirty days", () => {
    const [staging, production] = committed as [Ceilings, Ceilings];
    const thirtyDays = monthlyCostUsd(worstCaseUsage([staging, { ...production, resultRetentionDays: 30 }]));
    expect(thirtyDays).toBeGreaterThan(0);
    expect(thirtyDays).toBeLessThan(1);
  });

  // ADR 0084: each photograph's small copy is held while its look is, counted at the upload ceiling.
  it("holds the try-on's worst case at 3.6 GB, 76% of R2's free storage with the photographs' share", () => {
    const { r2StorageBytes } = worstCaseUsage(committed);
    expect(Math.round(r2StorageBytes / 1e6)).toBe(3_598);
    const withPhotos = (r2StorageBytes + PHOTO_ALLOWANCE.r2StorageBytes) / R2_FREE_ALLOWANCE.r2StorageBytes;
    expect(Math.round(withPhotos * 1000)).toBe(760);
  });

  // ADR 0084: a client keeps one try-on for good (the look of a client never fitted is never let go), and every
  // client has booked a visit, so each visit may bring one. ADR 0093: each photograph has its thumbnail beside it.
  it("gives the free share room for about 440 visits' photographs, each with a kept try-on, beside the cards", () => {
    expect(PHOTO_ALLOWANCE.r2StorageBytes).toBe(PHOTO_SHARE_BYTES);
    expect(PHOTO_SHARE_BYTES).toBe(4e9);
    expect(KEPT_TRY_ON_BYTES).toBe(MAX_COPY_BYTES + MAX_RESULT_BYTES);
    expect(photoRunwayVisits()).toBe(444);
  });

  it("would give room for 1,312 visits with no try-on kept, and 1,110 with the look kept as small as the photograph", () => {
    expect(photoRunwayVisits(0)).toBe(1_312);
    expect(photoRunwayVisits(2 * MAX_COPY_BYTES)).toBe(1_110);
  });

  it("fails when a ceiling is raised to where R2 costs past the budget", () => {
    const [staging, production] = committed as [Ceilings, Ceilings];
    const tooManyRenders = worstCaseUsage([staging, { ...production, renderDaily: 20_000 }]);
    expect(overBudget(tooManyRenders)).toEqual([expect.stringMatching(/^R2 would cost \$\d+\.\d\d a month/) as string]);
    const tooManyReads = worstCaseUsage([staging, { ...production, resultReadDaily: 1_000_000 }]);
    expect(overBudget(tooManyReads)).toHaveLength(1);
  });

  it("reads the allowance Cloudflare publishes", () => {
    expect(R2_FREE_ALLOWANCE).toEqual({
      r2StorageBytes: 10e9,
      r2ClassAPerMonth: 1_000_000,
      r2ClassBPerMonth: 10_000_000,
    });
  });
});
