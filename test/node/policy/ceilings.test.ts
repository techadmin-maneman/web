// The national daily ceilings' committed figures (src/policy/ops-settings-ceilings.ts) are production's own, as its
// config gives them, so the console's register never names figures production does not run on.

import { describe, expect, it } from "vitest";
import { readJsonc } from "../../../scripts/lib/jsonc.ts";
import { FIXED_LIMITS } from "../../../src/config/limits.ts";
import { PRODUCTION_CEILINGS } from "../../../src/policy/ops-settings-ceilings.ts";
import { RATE_LIMITS } from "../../../src/policy/rate-limits.ts";

const production = (readJsonc("wrangler.jsonc") as { env: { production: { vars: Record<string, string> } } }).env
  .production.vars;

describe("the daily ceilings' committed figures", () => {
  it("are production's, from its vars, the fixed limits and the dispatch board's own", () => {
    expect(PRODUCTION_CEILINGS).toEqual({
      upload: Number(production.UPLOAD_DAILY_CEILING),
      render: Number(production.RENDER_DAILY_CEILING),
      result_read: Number(production.RESULT_READ_DAILY_CEILING),
      login_code: FIXED_LIMITS.OTP_DAILY_CEILING,
      tech_code: FIXED_LIMITS.OTP_TECH_DAILY_CEILING,
      form_code: FIXED_LIMITS.OTP_DAILY_CEILING,
      geocode: FIXED_LIMITS.GEOCODE_DAILY_CEILING,
      route: RATE_LIMITS["ceiling:route"].limit,
      route_map: RATE_LIMITS["ceiling:route_map"].limit,
    });
  });
});
