// The smoke suite: the few requests that prove a deployment is the right code,
// in the right environment, on the right database, with routing intact. Runs
// after every staging and production deploy, and against wrangler dev in CI.

import type { EnvironmentName } from "../../src/config/environments.ts";

export interface SmokeOptions {
  readonly apiBase: string;
  readonly siteBase: string;
  readonly environment: EnvironmentName;
  /** Require /api/health to report this Worker version (gradual deployments). */
  readonly versionId?: string;
  /** Require /api/health to report this upload tag (the git SHA). */
  readonly versionTag?: string;
  /** Sent on every request: Access service-token headers, version overrides. */
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

type Check = (options: Required<Pick<SmokeOptions, "fetch">> & SmokeOptions) => Promise<string>;

class SmokeFailure extends Error {}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new SmokeFailure(message);
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

async function getJson(res: Response): Promise<Record<string, unknown>> {
  const type = res.headers.get("content-type") ?? "";
  assert(type.includes("application/json"), `expected JSON, got "${type}"`);
  const body: unknown = await res.json();
  assert(typeof body === "object" && body !== null && !Array.isArray(body), "expected a JSON object");
  return body as Record<string, unknown>;
}

const health: Check = async (o) => {
  const attempts = o.healthAttempts ?? 5;
  let last = "";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await o.fetch(`${o.apiBase}/api/health`, { headers: o.headers ?? {} });
      const requestId = res.headers.get("x-request-id");
      const body = await getJson(res);
      assert(res.status === 200, `status ${String(res.status)}, body ${JSON.stringify(body)}`);
      assert(
        body.environment === o.environment,
        `environment is ${String(body.environment)}, expected ${o.environment}`,
      );
      assert(body.d1 === "ok", `d1 is ${String(body.d1)}`);
      assert(requestId !== null && requestId !== "", "no X-Request-Id header");
      assert(res.headers.get("cache-control") === "no-store", "health must not be cacheable");
      if (o.versionId !== undefined) {
        assert(body.version_id === o.versionId, `version_id is ${String(body.version_id)}, expected ${o.versionId}`);
      }
      if (o.versionTag !== undefined) {
        assert(
          body.version_tag === o.versionTag,
          `version_tag is ${String(body.version_tag)}, expected ${o.versionTag}`,
        );
      }
      return `${o.environment}, version ${String(body.version_id)}, d1 ok`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
      if (attempt < attempts) await sleep(o.retryDelayMs ?? 3000);
    }
  }
  throw new SmokeFailure(`after ${String(attempts)} attempt(s): ${last}`);
};

const apiNotFound: Check = async (o) => {
  const res = await o.fetch(`${o.apiBase}/api/__smoke/not-found`, { headers: o.headers ?? {} });
  assert(res.status === 404, `status ${String(res.status)}`);
  const body = await getJson(res);
  const error = body.error as Record<string, unknown> | undefined;
  assert(error?.code === "not_found", `error code is ${String(error?.code)}`);
  assert(error.request_id === res.headers.get("x-request-id"), "error request_id does not match the header");
  assert(Object.keys(body).length === 1 && Object.keys(error).length === 2, "error body carries extra fields");
  return "stable error code and request ID";
};

const site: Check = async (o) => {
  const res = await o.fetch(`${o.siteBase}/`, { headers: o.headers ?? {} });
  assert(res.status === 200, `status ${String(res.status)}`);
  const html = await res.text();
  assert(html.includes('<meta name="mm-worker" content="mm-site"'), "the page is not served by mm-site");
  assert(
    html.includes(`<meta name="mm-environment" content="${o.environment}"`),
    `the page is not the ${o.environment} site`,
  );
  return `mm-site serves the ${o.environment} page`;
};

const indexing: Check = async (o) => {
  const [siteRes, apiRes] = await Promise.all([
    o.fetch(`${o.siteBase}/`, { headers: o.headers ?? {} }),
    o.fetch(`${o.apiBase}/api/health`, { headers: o.headers ?? {} }),
  ]);
  const siteTag = siteRes.headers.get("x-robots-tag") ?? "";
  const apiTag = apiRes.headers.get("x-robots-tag") ?? "";
  if (o.environment === "production") {
    assert(!siteTag.includes("noindex"), "production site is marked noindex");
    return "production is indexable";
  }
  assert(siteTag.includes("noindex"), `site X-Robots-Tag is "${siteTag}"`);
  assert(apiTag.includes("noindex"), `API X-Robots-Tag is "${apiTag}"`);
  return "noindex on site and API";
};

export const CHECKS: readonly [string, Check][] = [
  ["mm-api /api/health", health],
  ["mm-api error shape", apiNotFound],
  ["mm-site routing", site],
  ["indexing", indexing],
];

export async function runSmoke(options: SmokeOptions): Promise<SmokeResult[]> {
  const resolved = { ...options, fetch: options.fetch ?? fetch };
  const results: SmokeResult[] = [];
  for (const [name, check] of CHECKS) {
    try {
      results.push({ name, ok: true, detail: await check(resolved) });
    } catch (error) {
      results.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}
