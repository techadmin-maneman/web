// No ceiling in the committed config may take R2 past 80% of its free allowance, counting the share set aside for
// Phase 2. Raising one past it fails here (docs/decisions/0009, 0039).

import { describe, expect, it } from "vitest";
import {
  FREE_TIER,
  KEPT_TRY_ON_BYTES,
  overBudget,
  PHASE_2_ALLOWANCE,
  photoRunwayVisits,
  worstCaseUsage,
  type Ceilings,
} from "../../../scripts/lib/free-tier-budget.ts";
import { MAX_COPY_BYTES, MAX_RESULT_BYTES } from "../../../src/config/tryon.ts";
import { PHASE_2_SHARE_BYTES } from "../../../src/policy/storage-share.ts";
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
  it("keeps the committed ceilings, staging and production together, with Phase 2's share, under 80% of R2's free allowance", () => {
    expect(overBudget(worstCaseUsage(committed))).toEqual([]);
  });

  it("has no room for Phase 2's photographs if the try-on kept its results for thirty days", () => {
    const [staging, production] = committed as [Ceilings, Ceilings];
    const thirtyDays = worstCaseUsage([staging, { ...production, resultRetentionDays: 30 }]);
    expect(overBudget(thirtyDays)).toEqual([expect.stringMatching(/^R2 storage/) as string]);
  });

  // ADR 0084: each photograph's small copy is held while its look is, counted at the upload ceiling.
  it("holds the try-on's worst case at 3.6 GB, 76% of R2 with Phase 2's share", () => {
    const { r2StorageBytes } = worstCaseUsage(committed);
    expect(Math.round(r2StorageBytes / 1e6)).toBe(3_598);
    const withPhase2 = (r2StorageBytes + PHASE_2_ALLOWANCE.r2StorageBytes) / FREE_TIER.r2StorageBytes;
    expect(Math.round(withPhase2 * 1000)).toBe(760);
  });

  // ADR 0084: a client keeps one try-on for good (the look of a client never fitted is never let go), and every
  // client has booked a visit, so each visit may bring one. ADR 0093: each photograph has its thumbnail beside it.
  it("gives Phase 2 room for about 440 visits' photographs, each with a kept try-on, beside the referral cards", () => {
    expect(PHASE_2_ALLOWANCE.r2StorageBytes).toBe(PHASE_2_SHARE_BYTES);
    expect(PHASE_2_SHARE_BYTES).toBe(4e9);
    expect(KEPT_TRY_ON_BYTES).toBe(MAX_COPY_BYTES + MAX_RESULT_BYTES);
    expect(photoRunwayVisits()).toBe(444);
  });

  it("would give room for 1,312 visits with no try-on kept, and 1,110 with the look kept as small as the photograph", () => {
    expect(photoRunwayVisits(0)).toBe(1_312);
    expect(photoRunwayVisits(2 * MAX_COPY_BYTES)).toBe(1_110);
  });

  it("fails when a ceiling is raised past R2's free allowance", () => {
    const [staging, production] = committed as [Ceilings, Ceilings];
    const tooManyRenders = worstCaseUsage([staging, { ...production, renderDaily: 200 }]);
    expect(overBudget(tooManyRenders)).toEqual([expect.stringMatching(/^R2 storage/) as string]);
    const tooManyReads = worstCaseUsage([staging, { ...production, resultReadDaily: 300_000 }]);
    expect(overBudget(tooManyReads)).toEqual([expect.stringMatching(/^R2 Class B/) as string]);
  });

  it("reads the allowances Cloudflare publishes", () => {
    expect(FREE_TIER).toEqual({
      r2StorageBytes: 10e9,
      r2ClassAPerMonth: 1_000_000,
      r2ClassBPerMonth: 10_000_000,
    });
  });
});
