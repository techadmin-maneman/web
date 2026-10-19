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
    expect(await answer.json()).toEqual({
      cities: ["Gurgaon", "Mumbai"],
      areas: { Gurgaon: ["DLF Phase 2", "Sector 65"], Mumbai: ["Bandra"] },
    });
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

  it("leaves out of its list of cities each one with no pincode served", async () => {
    const { env: siteBindings } = siteEnv(
      () => Response.json({ cities: ["Gurgaon"] }),
      `<!doctype html><html><head></head><body><ul><li data-city="Gurgaon">Gurgaon</li><li data-city="Delhi">Delhi</li></ul></body></html>`,
    );
    const response = await createSiteWorker().fetch(new Request("https://maneman.in/areas"), siteBindings);
    const html = await response.text();
    expect(html).toContain('<li data-city="Gurgaon">Gurgaon</li>');
    expect(html).not.toContain("Delhi");
  });

  it("asks nothing for a page that names no city", async () => {
    const page = await visit("/guides", () => Response.json({ cities: ["Gurgaon"] }));
    expect(page.asked).toEqual([]);
  });
});

describe("the site Worker on a city's page", () => {
  const PAGE = `<!doctype html><html><head></head><body>
<section data-city-areas="Gurgaon" hidden><h2>Where we come in Gurgaon</h2><ul class="areas" data-areas-of="Gurgaon"></ul></section>
</body></html>`;

  async function opened(api: Api) {
    const { env } = siteEnv(api, PAGE);
    return createSiteWorker().fetch(new Request("https://maneman.in/areas/gurgaon"), env);
  }
  const visit = async (api: Api) => (await opened(api)).text();

  // The city pages were the five names on /areas alone, with nothing of each city's own.
  it("lists the areas served there, each written as text, and shows them", async () => {
    const html = await visit(() =>
      Response.json({ cities: ["Gurgaon"], areas: { Gurgaon: ["DLF Phase 2", "Sector <65>"] } }),
    );
    expect(html).toMatch(/<section data-city-areas="Gurgaon"\s*>/);
    expect(html).toContain("<li>DLF Phase 2</li><li>Sector &#60;65&#62;</li>");
  });

  // Gurgaon's page listed "Gurgaon" among Gurgaon's areas: the post office named for the city.
  it("leaves out the area named for the city itself", async () => {
    const html = await visit(() =>
      Response.json({ cities: ["Gurgaon"], areas: { Gurgaon: ["DLF Phase 2", "Gurgaon", "Sohna"] } }),
    );
    expect(html).toContain("<li>DLF Phase 2</li><li>Sohna</li>");
  });

  // Delhi's page said a technician comes to your home in Delhi, where no pincode was served.
  it("sends a city with no pincode served to the cities we come to", async () => {
    const response = await opened(() => Response.json({ cities: ["Noida"], areas: { Noida: ["Sector 18"] } }));
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://maneman.in/areas");
  });

  it("keeps the areas hidden while mm-api cannot say", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const html = await visit(() => new Response(null, { status: 503 }));
    expect(html).toContain('<section data-city-areas="Gurgaon" hidden>');
    expect(html).toContain('<ul class="areas" data-areas-of="Gurgaon"></ul>');
  });
});
