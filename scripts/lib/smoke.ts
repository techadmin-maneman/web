// The smoke suite: the few requests that prove a deployment is the right code,
// in the right environment, on the right database, with routing intact. Runs
// after every staging and production deploy, and against wrangler dev in CI.

import type { EnvironmentName, Surface } from "../../src/config/environments.ts";
import { STATIC_WORKERS } from "./workers.ts";

export interface SmokeOptions {
  readonly apiBase: string;
  readonly siteBase: string;
  readonly environment: EnvironmentName;
  /** Which surface's host this is (docs/decisions/0026-hosts-and-surfaces.md). The public site unless given. */
  readonly surface?: Surface;
  /** Require /api/health to report this Worker version ID. */
  readonly versionId?: string;
  /** Require /api/health, and a surface's app at /, to report this upload tag (the git SHA). */
  readonly versionTag?: string;
  /** Sent on every request, e.g. the Access service token or a version override. */
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetch?: typeof fetch;
  /** How many times a check that waits for a deploy to reach every edge tries. */
  readonly attempts?: number;
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
const ATTEMPTS = 12;
const RETRY_DELAY_MS = 5_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Runs `attempt` until it passes or the attempts run out: a deploy takes a moment to reach every edge. */
async function retried(options: SmokeOptions, attempt: () => Promise<string>): Promise<string> {
  const attempts = options.attempts ?? ATTEMPTS;
  let lastFailure = "";
  for (let tried = 1; tried <= attempts; tried++) {
    try {
      return await attempt();
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
      if (tried < attempts) await sleep(options.retryDelayMs ?? RETRY_DELAY_MS);
    }
  }
  throw new Error(`after ${String(attempts)} attempt(s): ${lastFailure}`);
}

/** The content of a page's `<meta name="…">`, or "none". */
function metaContent(html: string, name: string): string {
  return new RegExp(`<meta name="${name}" content="([^"]*)"`).exec(html)?.[1] ?? "none";
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
const health: Check = ({ options, api }) =>
  retried(options, async () => {
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
  });

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

/**
 * The pages the site's Worker answers before its assets (run_worker_first in site/wrangler.jsonc). It serves each
 * through its assets binding, which keeps the rules of the site's _headers; nothing else would notice if a change to
 * the Worker lost them. Any invite code will do: the Worker serves the built page for every one.
 */
const WORKER_PAGES = ["/", "/book", "/r/SMOKE0"] as const;

/** The only words on the page production serves until the site goes live there, which has no _headers. */
const PRODUCTION_PLACEHOLDER = "Placeholder for the production site";

/** Each page the site's Worker answers first keeps the site's security headers, and outside production its noindex. */
const siteSecurityHeaders: Check = async ({ options, site }) => {
  for (const path of WORKER_PAGES) {
    const response = await site(path);
    const html = await response.text();
    if (options.environment === "production" && html.includes(PRODUCTION_PLACEHOLDER)) {
      return "production still serves its placeholder (docs/frontend.md, Going live in production)";
    }
    assert(response.status === 200, `${path} answered ${String(response.status)}`);
    const headers = response.headers;
    const policy = headers.get("content-security-policy") ?? "";
    assert(
      policy.includes("default-src 'self'") && policy.includes("frame-ancestors 'none'"),
      `${path} has Content-Security-Policy "${policy}"`,
    );
    const transport = headers.get("strict-transport-security") ?? "";
    assert(transport.includes("max-age="), `${path} has Strict-Transport-Security "${transport}"`);
    const sniffing = headers.get("x-content-type-options") ?? "";
    assert(sniffing === "nosniff", `${path} has X-Content-Type-Options "${sniffing}"`);
    const robots = headers.get("x-robots-tag") ?? "";
    assert(options.environment === "production" || robots.includes("noindex"), `${path} is not noindex`);
  }
  return `the policy, HSTS and nosniff on ${WORKER_PAGES.join(", ")}`;
};

/** A Phase 2 surface's host serves none of the public site's routes. */
const publicRoutesAbsent: Check = async ({ api }) => {
  const response = await api("/api/cities");
  assert(response.status === 404, `/api/cities answered ${String(response.status)}; it belongs to the public site`);
  const body = await readJsonObject(response);
  assert((body.error as Record<string, unknown> | undefined)?.code === "not_found", "the 404 is not ours");
  return "the public site's routes are not here";
};

/** Outside production, a surface's API is noindex, as the public site's is. */
const apiIndexing: Check = async ({ options, api }) => {
  if (options.environment === "production") return "production: not required";
  const tag = (await api("/api/health")).headers.get("x-robots-tag") ?? "";
  assert(tag.includes("noindex"), `API X-Robots-Tag is "${tag}"`);
  return "noindex on the API";
};

/** The Worker that serves a Phase 2 surface's app, from the registry (scripts/lib/workers.ts). */
function appWorkerFor(surface: Surface | undefined): string {
  const worker = STATIC_WORKERS.find((entry) => entry.surface === surface);
  if (worker === undefined) throw new Error(`no app serves the ${String(surface)} surface`);
  return worker.name;
}

/**
 * The app a surface's host serves at /: its own Worker, this environment's
 * build, and, given a tag, built from that commit. Each app's build names all
 * three in the page (apps/<app>/vite.config.ts). Retried, as health is.
 */
const appAtRoot: Check = ({ options, site }) =>
  retried(options, async () => {
    const worker = appWorkerFor(options.surface);
    const response = await site("/");
    assert(response.status === 200, `status ${String(response.status)}`);

    const html = await response.text();
    const expected: [name: string, value: string | undefined][] = [
      ["mm-worker", worker],
      ["mm-environment", options.environment],
      ["mm-version", options.versionTag],
    ];
    for (const [name, value] of expected) {
      const found = metaContent(html, name);
      assert(value === undefined || found === value, `${name} is ${found}, expected ${String(value)}`);
    }
    const of = options.versionTag === undefined ? "" : ` of ${options.versionTag}`;
    return `${worker} serves the ${options.environment} build${of}`;
  });

export const CHECKS: readonly (readonly [name: string, check: Check])[] = [
  ["mm-api /api/health", health],
  ["mm-api error shape", errorShape],
  ["mm-api cities", cities],
  ["mm-site routing", siteRouting],
  ["indexing", indexing],
  ["site security headers", siteSecurityHeaders],
];

/** For the client, ops and technician hosts: mm-api on the host, and the app the host serves. */
export const SURFACE_CHECKS: readonly (readonly [name: string, check: Check])[] = [
  ["mm-api /api/health", health],
  ["mm-api error shape", errorShape],
  ["public routes absent", publicRoutesAbsent],
  ["indexing", apiIndexing],
  ["app at /", appAtRoot],
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
  for (const [name, check] of (options.surface ?? "public") === "public" ? CHECKS : SURFACE_CHECKS) {
    try {
      results.push({ name, ok: true, detail: await check(target) });
    } catch (error) {
      results.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}
