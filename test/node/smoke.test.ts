import { describe, expect, it } from "vitest";
import { runSmoke, type SmokeOptions } from "../../scripts/lib/smoke.ts";

/** How the fake deployment misbehaves. Anything left out answers correctly. */
interface Faults {
  health?: { status?: number; body?: Record<string, unknown>; headers?: Record<string, string> };
  notFound?: { status?: number; body?: unknown; requestId?: string };
  site?: { status?: number; html?: string; robots?: string | null };
}

const REQUEST_ID = "4b0e6c0a-0000-4000-8000-000000000001";

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

  function sitePage(): Response {
    const robots = faults.site?.robots === undefined ? robotsTag : faults.site.robots;
    const html =
      faults.site?.html ??
      `<meta name="mm-worker" content="mm-site" /><meta name="mm-environment" content="${environment}" />`;
    return new Response(html, {
      status: faults.site?.status ?? 200,
      headers: robots === null ? {} : { "x-robots-tag": robots },
    });
  }

  const fakeFetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : input.toString();
    seen.push(new Headers(init?.headers));
    if (url.endsWith("/api/health")) return Promise.resolve(health());
    if (url.includes("/api/")) return Promise.resolve(notFound());
    return Promise.resolve(sitePage());
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
    healthAttempts: 2,
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
    ]);
    expect(await failures(smokeOptions("production", { site: { robots: "noindex" } }))).toEqual([
      "indexing: production site is marked noindex",
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
