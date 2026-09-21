// The smoke suite: the few requests that prove a deployment is the right code,
// in the right environment, on the right database, with routing intact. Runs
// after every staging and production deploy, and against wrangler dev in CI.

import type { EnvironmentName } from "../../src/config/environments.ts";

export interface SmokeOptions {
  readonly apiBase: string;
  readonly siteBase: string;
  readonly environment: EnvironmentName;
  /** Require /api/health to report this Worker version ID. */
  readonly versionId?: string;
  /** Require /api/health to report this upload tag (the git SHA). */
  readonly versionTag?: string;
  /** Sent on every request, e.g. the Access service token or a version override. */
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetch?: typeof fetch;
  readonly healthAttempts?: number;
  readonly retryDelayMs?: number;
}

export interface SmokeResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

/** What each check gets: the expectations, and a way to call each Worker. */
interface Target {
  readonly options: SmokeOptions;
  readonly api: (path: string) => Promise<Response>;
  readonly site: (path: string) => Promise<Response>;
}

/** A check returns a one-line summary, or throws with the reason it failed. */
type Check = (target: Target) => Promise<string>;

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/**
 * A new version usually serves everywhere within seconds, but on 21 September
 * 2026 staging served the previous one for over 12 s. Allow a minute.
 */
const HEALTH_ATTEMPTS = 12;
const HEALTH_RETRY_DELAY_MS = 5_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJsonObject(response: Response): Promise<Record<string, unknown>> {
  const contentType = response.headers.get("content-type") ?? "";
  assert(contentType.includes("application/json"), `expected JSON, got "${contentType}"`);
  const body: unknown = await response.json();
  assert(typeof body === "object" && body !== null && !Array.isArray(body), "expected a JSON object");
  return body as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/** The right environment, version and database. Retried: a deploy takes a moment to reach every edge. */
const health: Check = async ({ options, api }) => {
  const attempts = options.healthAttempts ?? HEALTH_ATTEMPTS;
  let lastFailure = "";

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await api("/api/health");
      const body = await readJsonObject(response);
      assert(response.status === 200, `status ${String(response.status)}, body ${JSON.stringify(body)}`);
      assert(
        body.environment === options.environment,
        `environment is ${String(body.environment)}, expected ${options.environment}`,
      );
      assert(body.d1 === "ok", `d1 is ${String(body.d1)}`);
      assert((response.headers.get("x-request-id") ?? "") !== "", "no X-Request-Id header");
      assert(response.headers.get("cache-control") === "no-store", "health must not be cacheable");
      if (options.versionId !== undefined) {
        assert(
          body.version_id === options.versionId,
          `version_id is ${String(body.version_id)}, expected ${options.versionId}`,
        );
      }
      if (options.versionTag !== undefined) {
        assert(
          body.version_tag === options.versionTag,
          `version_tag is ${String(body.version_tag)}, expected ${options.versionTag}`,
        );
      }
      return `${options.environment}, version ${String(body.version_id)}, d1 ok`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
      if (attempt < attempts) await sleep(options.retryDelayMs ?? HEALTH_RETRY_DELAY_MS);
    }
  }
  throw new Error(`after ${String(attempts)} attempt(s): ${lastFailure}`);
};

/** Errors carry exactly a stable code and the request ID. */
const errorShape: Check = async ({ api }) => {
  const response = await api("/api/__smoke/not-found");
  assert(response.status === 404, `status ${String(response.status)}`);

  const body = await readJsonObject(response);
  const error = body.error as Record<string, unknown> | undefined;
  assert(error?.code === "not_found", `error code is ${String(error?.code)}`);
  assert(error.request_id === response.headers.get("x-request-id"), "error request_id does not match the header");
  assert(Object.keys(body).length === 1 && Object.keys(error).length === 2, "error body carries extra fields");
  return "stable error code and request ID";
};

/** The booking form's city list comes back, so the database is migrated and seeded. */
const cities: Check = async ({ api }) => {
  const response = await api("/api/cities");
  assert(response.status === 200, `status ${String(response.status)}`);

  const body: unknown = await response.json();
  assert(Array.isArray(body) && body.length > 0, "the city list is empty");
  const served = body.filter((city: { served?: unknown }) => city.served === true).length;
  assert(served > 0, "no city is served");
  return `${String(body.length)} cities, ${String(served)} served`;
};

/** Everything outside /api/* reaches mm-site, and it is this environment's site. */
const siteRouting: Check = async ({ options, site }) => {
  const response = await site("/");
  assert(response.status === 200, `status ${String(response.status)}`);

  const html = await response.text();
  assert(html.includes('<meta name="mm-worker" content="mm-site"'), "the page is not served by mm-site");
  assert(
    html.includes(`<meta name="mm-environment" content="${options.environment}"`),
    `the page is not the ${options.environment} site`,
  );
  return `mm-site serves the ${options.environment} page`;
};

/** Staging and local are noindex everywhere; production is indexable. */
const indexing: Check = async ({ options, api, site }) => {
  const siteTag = (await site("/")).headers.get("x-robots-tag") ?? "";
  const apiTag = (await api("/api/health")).headers.get("x-robots-tag") ?? "";

  if (options.environment === "production") {
    assert(!siteTag.includes("noindex"), "production site is marked noindex");
    return "production is indexable";
  }
  assert(siteTag.includes("noindex"), `site X-Robots-Tag is "${siteTag}"`);
  assert(apiTag.includes("noindex"), `API X-Robots-Tag is "${apiTag}"`);
  return "noindex on site and API";
};

export const CHECKS: readonly (readonly [name: string, check: Check])[] = [
  ["mm-api /api/health", health],
  ["mm-api error shape", errorShape],
  ["mm-api cities", cities],
  ["mm-site routing", siteRouting],
  ["indexing", indexing],
];

export async function runSmoke(options: SmokeOptions): Promise<SmokeResult[]> {
  const doFetch = options.fetch ?? fetch;
  const headers = { ...options.headers };

  async function get(url: string): Promise<Response> {
    const response = await doFetch(url, { headers });
    // Cloudflare's bot protection or a WAF rule answered; the Worker never saw the request.
    if (response.headers.get("cf-mitigated") === "challenge") {
      const ray = response.headers.get("cf-ray") ?? "unknown";
      throw new Error(`Cloudflare challenged the request before it reached the Worker (Ray ID ${ray})`);
    }
    return response;
  }

  const target: Target = {
    options,
    api: (path) => get(`${options.apiBase}${path}`),
    site: (path) => get(`${options.siteBase}${path}`),
  };

  const results: SmokeResult[] = [];
  for (const [name, check] of CHECKS) {
    try {
      results.push({ name, ok: true, detail: await check(target) });
    } catch (error) {
      results.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}
