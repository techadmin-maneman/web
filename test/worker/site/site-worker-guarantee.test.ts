// The fit guarantee's days, as ops set them (docs/decisions/0256-fit-guarantee-setting.md): mm-api answers them
// (src/routes/public/fit-guarantee.ts), and the mm-site Worker writes them into the terms over the days the page was built
// with; while mm-api cannot say, the terms are served as built.

import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { legalDays } from "../../../site/src/lib/legal-days.ts";
import { createSiteWorker } from "../../../site/src/worker.ts";
import { appFor, markDatabase, NOW, request } from "../helpers.ts";
import { siteEnv, type Api } from "./site-worker-fixtures.ts";

const TERMS = `<!doctype html><html><head></head><body>
<p>you may notify us within <span data-guarantee-days>14 (fourteen)</span> days from the date</p>
</body></html>`;

const days = (html: string) => /data-guarantee-days>([^<]*)</.exec(html)?.[1];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the fit guarantee", () => {
  beforeEach(async () => {
    await markDatabase();
  });

  it("runs 14 days until ops set another, and then as they set it", async () => {
    expect(await (await request(appFor(), "/api/fit-guarantee")).json()).toEqual({ days: 14 });
    await env.DB.prepare(
      "INSERT INTO ops_settings (name, value, set_by, set_at) VALUES ('guarantee_days', '21', 'ops@localhost', ?1)",
    )
      .bind(NOW.toISOString())
      .run();
    const answer = await request(appFor(), "/api/fit-guarantee");
    expect(answer.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(await answer.json()).toEqual({ days: 21 });
  });

  it("is written in the terms' way", () => {
    expect(legalDays(14)).toBe("14 (fourteen)");
    expect(legalDays(21)).toBe("21 (twenty-one)");
    expect(legalDays(30)).toBe("30 (thirty)");
    expect(legalDays(7)).toBe("7 (seven)");
  });
});

describe("the site Worker on the terms", () => {
  async function visit(api: Api) {
    const { env: siteBindings } = siteEnv(api, TERMS);
    const response = await createSiteWorker().fetch(new Request("https://maneman.in/terms"), siteBindings);
    return response.text();
  }

  it("writes in the days ops set", async () => {
    expect(days(await visit(() => Response.json({ days: 21 })))).toBe("21 (twenty-one)");
  });

  it("serves the terms as built while mm-api cannot say", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(days(await visit(() => new Response(null, { status: 503 })))).toBe("14 (fourteen)");
  });
});
