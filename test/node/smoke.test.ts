import { describe, expect, it } from "vitest";
import { runSmoke, type SmokeOptions } from "../../scripts/lib/smoke.ts";

/** How the fake deployment misbehaves. Anything left out answers correctly. */
interface Faults {
  health?: { status?: number; body?: Record<string, unknown>; headers?: Record<string, string> };
  notFound?: { status?: number; body?: unknown; requestId?: string };
  site?: { status?: number; html?: string; robots?: string | null };
  /** A security header one page the site's Worker answers first has lost. */
  lostHeader?: { path: string; header: string };
  cities?: unknown;
  /** On a Phase 2 surface's host, the public site's routes must not answer. */
  publicRoutes?: "present" | "absent";
}

const REQUEST_ID = "4b0e6c0a-0000-4000-8000-000000000001";

/** What the site's _headers gives every page (site/src/lib/static-files.ts), shortened. */
const SITE_HEADERS = {
  "content-security-policy": "default-src 'self'; object-src 'none'; frame-ancestors 'none'",
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "x-content-type-options": "nosniff",
};

/** A fake deployment of both Workers that passes every smoke check unless `faults` says otherwise. */
function fakeDeployment(environment: string, faults: Faults = {}): { fetch: typeof fetch; seen: Headers[] } {
  const seen: Headers[] = [];
  const robotsTag = environment === "production" ? null : "noindex, nofollow";

  function json(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
    const headers: Record<string, string> = { "content-type": "application/json", "x-request-id": REQUEST_ID };
    if (robotsTag !== null) headers["x-robots-tag"] = robotsTag;
    return new Response(JSON.stringify(body), { status, headers: { ...headers, ...extraHeaders } });
  }

  function health(): Response {
    const body = faults.health?.body ?? { status: "ok", environment, version_id: "v-2", version_tag: "abc", d1: "ok" };
    return json(faults.health?.status ?? 200, body, { "cache-control": "no-store", ...faults.health?.headers });
  }

  function notFound(): Response {
    const requestId = faults.notFound?.requestId ?? REQUEST_ID;
    const body = faults.notFound?.body ?? { error: { code: "not_found", request_id: requestId } };
    return json(faults.notFound?.status ?? 404, body);
  }

  function sitePage(path: string): Response {
    const robots = faults.site?.robots === undefined ? robotsTag : faults.site.robots;
    const html =
      faults.site?.html ??
      `<meta name="mm-worker" content="mm-site" /><meta name="mm-environment" content="${environment}" />`;
    const headers = new Headers(SITE_HEADERS);
    if (robots !== null) headers.set("x-robots-tag", robots);
    if (faults.lostHeader?.path === path) headers.delete(faults.lostHeader.header);
    return new Response(html, { status: faults.site?.status ?? 200, headers });
  }

  const fakeFetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : input.toString();
    seen.push(new Headers(init?.headers));
    if (url.endsWith("/api/health")) return Promise.resolve(health());
    if (url.endsWith("/api/cities") && faults.publicRoutes !== "absent")
      return Promise.resolve(json(200, faults.cities ?? [{ name: "Gurgaon", served: true }]));
    if (url.includes("/api/")) return Promise.resolve(notFound());
    return Promise.resolve(sitePage(new URL(url).pathname));
  };
  return { fetch: fakeFetch, seen };
}

function smokeOptions(
  environment: SmokeOptions["environment"],
  faults?: Faults,
  extra: Partial<SmokeOptions> = {},
): SmokeOptions {
  return {
    apiBase: "https://h",
    siteBase: "https://h",
    environment,
    fetch: fakeDeployment(environment, faults).fetch,
    attempts: 2,
    retryDelayMs: 1,
    ...extra,
  };
}

/** "check name: reason" for every failed check. */
async function failures(options: SmokeOptions): Promise<string[]> {
  const results = await runSmoke(options);
  return results.filter((result) => !result.ok).map((result) => `${result.name}: ${result.detail}`);
}

async function firstFailure(options: SmokeOptions): Promise<string> {
  return (await failures(options))[0] ?? "";
}

describe("smoke suite", () => {
  it.each(["local", "staging", "production"] as const)("passes a healthy %s deployment", async (environment) => {
    expect(await failures(smokeOptions(environment))).toEqual([]);
  });

  it("fails when health reports another environment or a mismatched database", async () => {
    expect(
      await failures(smokeOptions("staging", { health: { body: { environment: "production", d1: "ok" } } })),
    ).toEqual(["mm-api /api/health: after 2 attempt(s): environment is production, expected staging"]);
    const mismatch = { health: { status: 503, body: { environment: "staging", d1: "mismatch" } } };
    expect(await firstFailure(smokeOptions("staging", mismatch))).toContain("status 503");
  });

  it("fails when the deployed version or tag is not the one uploaded", async () => {
    expect(await failures(smokeOptions("production", {}, { versionId: "v-3" }))).toEqual([
      "mm-api /api/health: after 2 attempt(s): version_id is v-2, expected v-3",
    ]);
    expect(await failures(smokeOptions("production", {}, { versionTag: "def" }))).toEqual([
      "mm-api /api/health: after 2 attempt(s): version_tag is abc, expected def",
    ]);
  });

  it("fails when health is cacheable or lacks a request ID", async () => {
    const cacheable = { health: { headers: { "cache-control": "max-age=60" } } };
    expect(await firstFailure(smokeOptions("staging", cacheable))).toContain("health must not be cacheable");
    expect(await firstFailure(smokeOptions("staging", { health: { headers: { "x-request-id": "" } } }))).toContain(
      "no X-Request-Id",
    );
  });

  it("fails when an API error leaks detail or loses the request ID", async () => {
    expect(
      await failures(
        smokeOptions("staging", {
          notFound: { body: { error: { code: "not_found", request_id: REQUEST_ID, stack: "at x" } } },
        }),
      ),
    ).toEqual(["mm-api error shape: error body carries extra fields"]);
    expect(await failures(smokeOptions("staging", { notFound: { requestId: "other" } }))).toEqual([
      "mm-api error shape: error request_id does not match the header",
    ]);
    expect(await failures(smokeOptions("staging", { notFound: { status: 200 } }))).toEqual([
      "mm-api error shape: status 200",
    ]);
  });

  it("fails when / is not served by mm-site, or by another environment's site", async () => {
    expect(await failures(smokeOptions("staging", { site: { html: "<html>origin</html>" } }))).toEqual([
      "mm-site routing: the page is not served by mm-site",
    ]);
    expect(
      await failures(
        smokeOptions("staging", {
          site: {
            html: '<meta name="mm-worker" content="mm-site" /><meta name="mm-environment" content="production" />',
          },
        }),
      ),
    ).toEqual(["mm-site routing: the page is not the staging site"]);
  });

  it("fails when staging is indexable or production is not", async () => {
    expect(await failures(smokeOptions("staging", { site: { robots: null } }))).toEqual([
      'indexing: site X-Robots-Tag is ""',
      "site security headers: / is not noindex",
    ]);
    expect(await failures(smokeOptions("production", { site: { robots: "noindex" } }))).toEqual([
      "indexing: production site is marked noindex",
    ]);
  });

  // The site's Worker answers these first and serves the built page through its assets binding, which keeps
  // the site's _headers; nothing but this would notice if a change to the Worker lost them.
  it.each(["/", "/book", "/r/SMOKE0"])(
    "fails when %s, which the site's Worker answers first, loses a security header",
    async (path) => {
      for (const header of ["content-security-policy", "strict-transport-security", "x-content-type-options"]) {
        const lost = await failures(smokeOptions("staging", { lostHeader: { path, header } }));
        expect(lost).toEqual([expect.stringMatching(new RegExp(`^site security headers: ${path} .*${header}`, "i"))]);
      }
      expect(await failures(smokeOptions("staging", { lostHeader: { path, header: "x-robots-tag" } }))).toContain(
        `site security headers: ${path} is not noindex`,
      );
    },
  );

  it("asks no headers of production's placeholder page, which it serves until the site goes live there", async () => {
    const placeholder = {
      html: '<meta name="mm-worker" content="mm-site" /><meta name="mm-environment" content="production" /><p>Mane Man. Placeholder for the production site.</p>',
    };
    const results = await runSmoke(
      smokeOptions("production", { site: placeholder, lostHeader: { path: "/", header: "content-security-policy" } }),
    );
    expect(results.filter((result) => !result.ok)).toEqual([]);
    expect(results.find((result) => result.name === "site security headers")?.detail).toBe(
      "production still serves its placeholder (docs/frontend.md, Going live in production)",
    );
    // Once the site is live there, production is held to them as staging is.
    expect(
      await failures(
        smokeOptions("production", { lostHeader: { path: "/book", header: "strict-transport-security" } }),
      ),
    ).toEqual([expect.stringContaining("site security headers: /book")]);
  });

  it("fails when the city list is empty or has no served city", async () => {
    expect(await failures(smokeOptions("staging", { cities: [] }))).toEqual(["mm-api cities: the city list is empty"]);
    expect(await failures(smokeOptions("staging", { cities: [{ name: "Mumbai", served: false }] }))).toEqual([
      "mm-api cities: no city is served",
    ]);
  });

  it("fails on a non-JSON health response", async () => {
    const fetchImpl = (() =>
      Promise.resolve(new Response("<html>", { headers: { "content-type": "text/html" } }))) as unknown as typeof fetch;
    expect(await firstFailure({ ...smokeOptions("staging"), fetch: fetchImpl })).toContain(
      'expected JSON, got "text/html"',
    );
  });

  it("says so when Cloudflare challenges the request instead of the Worker answering", async () => {
    const challenged = (() =>
      Promise.resolve(
        new Response("Just a moment...", {
          status: 403,
          headers: { "cf-mitigated": "challenge", "cf-ray": "a3e8cd28094115c2-SJC" },
        }),
      )) as unknown as typeof fetch;
    expect(await firstFailure({ ...smokeOptions("production"), fetch: challenged })).toContain(
      "Cloudflare challenged the request before it reached the Worker (Ray ID a3e8cd28094115c2-SJC)",
    );
  });

  it("sends the configured headers on every request", async () => {
    const fake = fakeDeployment("staging");
    await runSmoke({ ...smokeOptions("staging"), fetch: fake.fetch, headers: { "CF-Access-Client-Id": "id" } });
    expect(fake.seen.length).toBeGreaterThan(0);
    expect(fake.seen.every((headers) => headers.get("CF-Access-Client-Id") === "id")).toBe(true);
  });
});

/** The page a Phase 2 app's build writes at /, naming its Worker, environment and commit (apps/<app>/vite.config.ts). */
function appPage(worker: string, environment: string, version: string): string {
  return (
    `<!doctype html><html><head><meta name="mm-worker" content="${worker}" />\n` +
    `<meta name="mm-environment" content="${environment}" />\n<meta name="mm-version" content="${version}" />\n` +
    `</head><body><div id="root"></div></body></html>`
  );
}

describe("smoke suite, on a Phase 2 surface's host", () => {
  /** The ops host, which mm-api and mm-ops serve; mm-ops built from commit "abc" unless `faults` says otherwise. */
  const onSurface = (environment: SmokeOptions["environment"], faults: Faults = {}, versionTag = "abc") =>
    smokeOptions(
      environment,
      { publicRoutes: "absent", site: { html: appPage("mm-ops", environment, "abc") }, ...faults },
      { surface: "ops", versionTag },
    );

  it.each(["staging", "production"] as const)(
    "passes a healthy %s surface: mm-api on its host, and the app it serves at /",
    async (environment) => {
      const results = await runSmoke(onSurface(environment));
      expect(results.filter((result) => !result.ok)).toEqual([]);
      expect(results.map((result) => result.name)).toEqual([
        "mm-api /api/health",
        "mm-api error shape",
        "public routes absent",
        "indexing",
        "app at /",
      ]);
    },
  );

  it("fails when the public site's routes answer on the surface's host", async () => {
    expect(await failures(onSurface("staging", { publicRoutes: "present" }))).toEqual([
      "public routes absent: /api/cities answered 200; it belongs to the public site",
    ]);
  });

  it("fails when a staging surface is indexable", async () => {
    const indexable = { health: { headers: { "x-robots-tag": "all" } } };
    expect(await failures(onSurface("staging", indexable))).toEqual(['indexing: API X-Robots-Tag is "all"']);
  });

  it("fails when / on the host is not its app, as when the app's Worker was never deployed", async () => {
    expect(await failures(onSurface("staging", { site: { html: "<html>origin</html>" } }))).toEqual([
      "app at /: after 2 attempt(s): mm-worker is none, expected mm-ops",
    ]);
    expect(await failures(onSurface("staging", { site: { html: appPage("mm-app", "staging", "abc") } }))).toEqual([
      "app at /: after 2 attempt(s): mm-worker is mm-app, expected mm-ops",
    ]);
  });

  it("fails when the app was built from another commit, as when its deploy was skipped", async () => {
    const stale = { site: { html: appPage("mm-ops", "staging", "0ld") } };
    expect(await failures(onSurface("staging", stale))).toEqual([
      "app at /: after 2 attempt(s): mm-version is 0ld, expected abc",
    ]);
  });

  it("fails when the app is another environment's build, or does not answer", async () => {
    const other = { site: { html: appPage("mm-ops", "production", "abc") } };
    expect(await failures(onSurface("staging", other))).toEqual([
      "app at /: after 2 attempt(s): mm-environment is production, expected staging",
    ]);
    const down = { site: { status: 500, html: appPage("mm-ops", "staging", "abc") } };
    expect(await failures(onSurface("staging", down))).toEqual(["app at /: after 2 attempt(s): status 500"]);
  });

  it("does not ask for a version when none is given", async () => {
    const untagged = smokeOptions(
      "staging",
      { publicRoutes: "absent", site: { html: appPage("mm-ops", "staging", "anything") } },
      { surface: "ops" },
    );
    expect(await failures(untagged)).toEqual([]);
  });
});
