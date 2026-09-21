// No ceiling in the committed config may take the account past 80% of a free
// allowance. Raising one past it fails here (docs/decisions/0009).

import { describe, expect, it } from "vitest";
import {
  FREE_TIER,
  overBudget,
  queueOperationsPerRender,
  worstCaseUsage,
  type Ceilings,
} from "../../scripts/lib/free-tier-budget.ts";
import { readJsonc } from "../../scripts/lib/jsonc.ts";

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

describe("free-tier budget", () => {
  it("keeps the committed ceilings, staging and production together, under 80% of every free allowance", () => {
    expect(overBudget(worstCaseUsage(committed))).toEqual([]);
  });

  it("counts a render polled to the give-up time, its download retries, its message and its CRM sync", () => {
    // 3 + 6 early polls + 15 late + 12 slow + 1 final + 3 download retries; 3 + 3 for the message; 3 + 1 for the CRM.
    expect(queueOperationsPerRender()).toBe(50);
  });

  it("fails when a ceiling is raised past the free tier", () => {
    const [staging, production] = committed as [Ceilings, Ceilings];
    const tooManyRenders = worstCaseUsage([staging, { ...production, renderDaily: 200 }]);
    expect(overBudget(tooManyRenders)).toEqual([
      expect.stringMatching(/^Queues operations a day/) as string,
      expect.stringMatching(/^R2 storage/) as string,
    ]);
    const tooManyReads = worstCaseUsage([staging, { ...production, resultReadDaily: 300_000 }]);
    expect(overBudget(tooManyReads)).toEqual([expect.stringMatching(/^R2 Class B/) as string]);
  });

  it("reads the allowances Cloudflare publishes", () => {
    expect(FREE_TIER).toEqual({
      queueOperationsPerDay: 10_000,
      r2StorageBytes: 10e9,
      r2ClassAPerMonth: 1_000_000,
      r2ClassBPerMonth: 10_000_000,
    });
  });
});
