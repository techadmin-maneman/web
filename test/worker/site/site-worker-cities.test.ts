// The cities the site says it comes to: mm-api answers those with a pincode ops serve (src/routes/public/served-cities.ts),
// and the mm-site Worker writes them into each sentence on / and /areas that names them, over the one the page was
// built with, which names none; while mm-api cannot say, the page is served as built.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSiteWorker } from "../../../site/src/worker.ts";
import { citiesWords } from "../../../site/src/lib/cities.ts";
import { appFor, markDatabase, request } from "../helpers.ts";
import { pincode } from "./consultations-fixtures.ts";
import { siteEnv, type Api } from "./site-worker-fixtures.ts";

const CITY_PAGE = `<!doctype html><html><head></head><body>
<p class="lead" data-cities="Your technician comes to your home in {cities}.">Your technician comes to your home, wherever we serve.</p>
<p>Nothing to name</p>
</body></html>`;

const named = (html: string) => /data-cities="[^"]*">([^<]*)</.exec(html)?.[1];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the cities ops serve", () => {
  beforeEach(async () => {
    await markDatabase();
  });

  it("are each city with a pincode served, in the console's order, and none that is only waited for", async () => {
    await pincode("400050", "Bandra", "Mumbai", true);
    await pincode("122018", "Sector 65", "Gurgaon", true);
    await pincode("122002", "DLF Phase 2", "Gurgaon", true);
    await pincode("201301", "Sector 18", "Noida", false);
    const answer = await request(appFor(), "/api/served-cities");
    expect(answer.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(await answer.json()).toEqual({ cities: ["Gurgaon", "Mumbai"] });
  });

  it("read as a sentence does", () => {
    expect(citiesWords(["Gurgaon"])).toBe("Gurgaon");
    expect(citiesWords(["Gurgaon", "Mumbai"])).toBe("Gurgaon and Mumbai");
    expect(citiesWords(["Gurgaon", "Noida", "Mumbai"])).toBe("Gurgaon, Noida and Mumbai");
  });
});

describe("the site Worker on a page that names the cities", () => {
  async function visit(path: string, api: Api) {
    const { env: siteBindings, asked } = siteEnv(api, CITY_PAGE);
    const response = await createSiteWorker().fetch(new Request(`https://maneman.in${path}`), siteBindings);
    return { html: await response.text(), asked };
  }

  it.each(["/", "/areas"])("writes in the cities served on %s", async (path) => {
    const page = await visit(path, () => Response.json({ cities: ["Gurgaon", "Mumbai"] }));
    expect(named(page.html)).toBe("Your technician comes to your home in Gurgaon and Mumbai.");
    expect(page.html).toContain("<p>Nothing to name</p>");
  });

  it("serves the page as built while mm-api cannot say, or says no city", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const api of [() => new Response(null, { status: 503 }), () => Response.json({ cities: [] })]) {
      const page = await visit("/areas", api);
      expect(named(page.html)).toBe("Your technician comes to your home, wherever we serve.");
    }
  });

  it("asks nothing for a page that names no city", async () => {
    const page = await visit("/guides", () => Response.json({ cities: ["Gurgaon"] }));
    expect(page.asked).toEqual([]);
  });
});
