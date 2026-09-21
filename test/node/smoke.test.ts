import { describe, expect, it } from "vitest";
import { runSmoke, type SmokeOptions } from "../../scripts/lib/smoke.ts";

interface Fake {
  health?: { status?: number; body?: Record<string, unknown>; headers?: Record<string, string> };
  notFound?: { status?: number; body?: unknown; requestId?: string };
  site?: { status?: number; html?: string; robots?: string | null };
}

const REQUEST_ID = "4b0e6c0a-0000-4000-8000-000000000001";

function fakeFetch(environment: string, fake: Fake = {}): { fetch: typeof fetch; seen: Headers[] } {
  const seen: Headers[] = [];
  const noindex = environment === "production" ? null : "noindex, nofollow";
  const fetchImpl = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : input.toString();
    seen.push(new Headers(init?.headers));
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
      new Response(JSON.stringify(body), {
        status,
        headers: {
          "content-type": "application/json",
          "x-request-id": REQUEST_ID,
          ...(noindex === null ? {} : { "x-robots-tag": noindex }),
          ...headers,
        },
      });
    if (url.endsWith("/api/health")) {
      return Promise.resolve(
        json(
          fake.health?.status ?? 200,
          fake.health?.body ?? { status: "ok", environment, version_id: "v-2", version_tag: "abc", d1: "ok" },
          { "cache-control": "no-store", ...fake.health?.headers },
        ),
      );
    }
    if (url.includes("/api/")) {
      return Promise.resolve(
        json(
          fake.notFound?.status ?? 404,
          fake.notFound?.body ?? { error: { code: "not_found", request_id: fake.notFound?.requestId ?? REQUEST_ID } },
        ),
      );
    }
    const robots = fake.site?.robots === undefined ? noindex : fake.site.robots;
    const html =
      fake.site?.html ??
      `<meta name="mm-worker" content="mm-site" /><meta name="mm-environment" content="${environment}" />`;
    return Promise.resolve(
      new Response(html, {
        status: fake.site?.status ?? 200,
        headers: robots === null ? {} : { "x-robots-tag": robots },
      }),
    );
  };
  return { fetch: fetchImpl, seen };
}

const base = (
  environment: SmokeOptions["environment"],
  fake?: Fake,
  extra: Partial<SmokeOptions> = {},
): SmokeOptions => ({
  apiBase: "https://h",
  siteBase: "https://h",
  environment,
  fetch: fakeFetch(environment, fake).fetch,
  healthAttempts: 2,
  retryDelayMs: 1,
  ...extra,
});

const failures = async (options: SmokeOptions) =>
  (await runSmoke(options)).filter((r) => !r.ok).map((r) => `${r.name}: ${r.detail}`);

describe("smoke suite", () => {
  it.each(["local", "staging", "production"] as const)("passes a healthy %s deployment", async (environment) => {
    expect(await failures(base(environment))).toEqual([]);
  });

  it("fails when health reports another environment or a mismatched database", async () => {
    expect(await failures(base("staging", { health: { body: { environment: "production", d1: "ok" } } }))).toEqual([
      "mm-api /api/health: after 2 attempt(s): environment is production, expected staging",
    ]);
    expect(
      (
        await failures(base("staging", { health: { status: 503, body: { environment: "staging", d1: "mismatch" } } }))
      )[0],
    ).toContain("status 503");
  });

  it("fails when the deployed version or tag is not the one uploaded", async () => {
    expect(await failures(base("production", {}, { versionId: "v-3" }))).toEqual([
      "mm-api /api/health: after 2 attempt(s): version_id is v-2, expected v-3",
    ]);
    expect(await failures(base("production", {}, { versionTag: "def" }))).toEqual([
      "mm-api /api/health: after 2 attempt(s): version_tag is abc, expected def",
    ]);
  });

  it("fails when health is cacheable or lacks a request ID", async () => {
    expect((await failures(base("staging", { health: { headers: { "cache-control": "max-age=60" } } })))[0]).toContain(
      "health must not be cacheable",
    );
    expect((await failures(base("staging", { health: { headers: { "x-request-id": "" } } })))[0]).toContain(
      "no X-Request-Id",
    );
  });

  it("fails when an API error leaks detail or loses the request ID", async () => {
    expect(
      await failures(
        base("staging", {
          notFound: { body: { error: { code: "not_found", request_id: REQUEST_ID, stack: "at x" } } },
        }),
      ),
    ).toEqual(["mm-api error shape: error body carries extra fields"]);
    expect(await failures(base("staging", { notFound: { requestId: "other" } }))).toEqual([
      "mm-api error shape: error request_id does not match the header",
    ]);
    expect(await failures(base("staging", { notFound: { status: 200 } }))).toEqual(["mm-api error shape: status 200"]);
  });

  it("fails when / is not served by mm-site, or by another environment's site", async () => {
    expect(await failures(base("staging", { site: { html: "<html>origin</html>" } }))).toEqual([
      "mm-site routing: the page is not served by mm-site",
    ]);
    expect(
      await failures(
        base("staging", {
          site: {
            html: '<meta name="mm-worker" content="mm-site" /><meta name="mm-environment" content="production" />',
          },
        }),
      ),
    ).toEqual(["mm-site routing: the page is not the staging site"]);
  });

  it("fails when staging is indexable or production is not", async () => {
    expect(await failures(base("staging", { site: { robots: null } }))).toEqual(['indexing: site X-Robots-Tag is ""']);
    expect(await failures(base("production", { site: { robots: "noindex" } }))).toEqual([
      "indexing: production site is marked noindex",
    ]);
  });

  it("fails on a non-JSON health response", async () => {
    const fetchImpl = (() =>
      Promise.resolve(new Response("<html>", { headers: { "content-type": "text/html" } }))) as unknown as typeof fetch;
    expect((await failures({ ...base("staging"), fetch: fetchImpl }))[0]).toContain('expected JSON, got "text/html"');
  });

  it("sends the configured headers on every request", async () => {
    const fake = fakeFetch("staging");
    await runSmoke({ ...base("staging"), fetch: fake.fetch, headers: { "CF-Access-Client-Id": "id" } });
    expect(fake.seen.length).toBeGreaterThan(0);
    expect(fake.seen.every((headers) => headers.get("CF-Access-Client-Id") === "id")).toBe(true);
  });
});
