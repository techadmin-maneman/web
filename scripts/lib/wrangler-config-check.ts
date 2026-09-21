// Rules that keep staging and production isolated in the wrangler config.
// Pure functions over parsed config, so the tests can break a real config one
// rule at a time. See docs/decisions/0005-environment-isolation-in-wrangler-config.md.

import {
  EXPECTED_DATABASE_NAME,
  HOSTNAME,
  REMOTE_ENVIRONMENTS,
  RESOURCE_TOKEN,
  ZONE_NAME,
  type EnvironmentName,
  type RemoteEnvironmentName,
} from "../../src/config/environments.ts";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = Record<string, Json>;

/**
 * Keys wrangler does NOT inherit from the top level into an environment. A key
 * present at the top level and missing from an environment leaves that
 * environment without the binding. Each maps to the binding names it declares.
 */
const NON_INHERITABLE: Readonly<Record<string, (value: Json) => string[]>> = {
  vars: (v) => (isObject(v) ? Object.keys(v) : []),
  define: (v) => (isObject(v) ? Object.keys(v) : []),
  d1_databases: (v) => field(v, "binding"),
  r2_buckets: (v) => field(v, "binding"),
  kv_namespaces: (v) => field(v, "binding"),
  services: (v) => field(v, "binding"),
  hyperdrive: (v) => field(v, "binding"),
  vectorize: (v) => field(v, "binding"),
  analytics_engine_datasets: (v) => field(v, "binding"),
  dispatch_namespaces: (v) => field(v, "binding"),
  mtls_certificates: (v) => field(v, "binding"),
  secrets_store_secrets: (v) => field(v, "binding"),
  workflows: (v) => field(v, "binding"),
  pipelines: (v) => field(v, "binding"),
  send_email: (v) => field(v, "name"),
  ratelimits: (v) => field(v, "name"),
  tail_consumers: (v) => field(v, "service"),
  version_metadata: (v) => single(v, "binding"),
  ai: (v) => single(v, "binding"),
  browser: (v) => single(v, "binding"),
  images: (v) => single(v, "binding"),
  durable_objects: (v) => (isObject(v) ? field(v.bindings ?? [], "name") : []),
  "queues.producers": (v) => field(v, "binding"),
  "queues.consumers": (v) => field(v, "queue").map(stripEnvironmentToken),
};

/**
 * Keys wrangler DOES inherit. Inheriting any of these into a remote
 * environment is dangerous (a route or account aimed at the wrong place), so
 * each remote environment must set them itself.
 */
const MUST_BE_EXPLICIT = ["name", "account_id", "workers_dev", "preview_urls", "observability", "routes"] as const;

const ENVIRONMENT_TOKENS = Object.values(RESOURCE_TOKEN);

export const PLACEHOLDER_DATABASE_ID = /^0{8}-0{4}-0{4}-0{4}-0{12}$/;

export const REQUIRED_API_BINDINGS = [
  "DB",
  "UPLOADS",
  "RESULTS",
  "RENDER_QUEUE",
  "CRM_QUEUE",
  "MESSAGE_QUEUE",
  "CF_VERSION_METADATA",
] as const;

export interface CheckOptions {
  /** Deploy-time: reject placeholder resource IDs. */
  readonly requireProvisioned?: boolean;
}

function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function field(value: Json, key: string): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const name = isObject(item) ? item[key] : undefined;
    return typeof name === "string" ? [name] : [];
  });
}

function single(value: Json, key: string): string[] {
  const name = isObject(value) ? value[key] : undefined;
  return typeof name === "string" ? [name] : [];
}

/** `mm-render-staging` and `mm-render-prod` are the same logical queue. */
function stripEnvironmentToken(name: string): string {
  return ENVIRONMENT_TOKENS.reduce((acc, token) => acc.replace(new RegExp(`(^|-)${token}(-|$)`), "$1{env}$2"), name);
}

function read(config: JsonObject, path: string): Json | undefined {
  let current: Json | undefined = config;
  for (const part of path.split(".")) {
    if (!isObject(current)) return undefined;
    current = current[part];
  }
  return current;
}

function environmentBlock(config: JsonObject, name: string): JsonObject | undefined {
  const envs = config.env;
  if (!isObject(envs)) return undefined;
  const block = envs[name];
  return isObject(block) ? block : undefined;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((item) => right.has(item));
}

/** Every non-inheritable key at the top level is redeclared, with the same binding names. */
function checkRedeclared(top: JsonObject, block: JsonObject, label: string): string[] {
  const problems: string[] = [];
  for (const [key, names] of Object.entries(NON_INHERITABLE)) {
    const topValue = read(top, key);
    const envValue = read(block, key);
    if (topValue === undefined && envValue === undefined) continue;
    if (envValue === undefined) {
      problems.push(
        `${label}: ${key} is not redeclared (the top level declares ${names(topValue ?? null).join(", ")})`,
      );
      continue;
    }
    if (topValue === undefined) {
      problems.push(`${label}: declares ${key}, which the top level (local) does not`);
      continue;
    }
    const expected = names(topValue);
    const actual = names(envValue);
    if (!sameSet(expected, actual)) {
      problems.push(
        `${label}: ${key} declares [${actual.join(", ")}] but the top level declares [${expected.join(", ")}]`,
      );
    }
  }
  // Inheritable trigger keys: redeclare explicitly if the top level has them.
  if (top.triggers !== undefined && block.triggers === undefined) {
    problems.push(`${label}: triggers is inherited from the top level; declare it explicitly`);
  }
  return problems;
}

/** Every resource an environment names must carry that environment's token. */
function resourceNames(block: JsonObject): { kind: string; name: string }[] {
  const out: { kind: string; name: string }[] = [];
  for (const db of Array.isArray(block.d1_databases) ? block.d1_databases : []) {
    if (isObject(db) && typeof db.database_name === "string") out.push({ kind: "D1 database", name: db.database_name });
  }
  for (const bucket of Array.isArray(block.r2_buckets) ? block.r2_buckets : []) {
    if (isObject(bucket) && typeof bucket.bucket_name === "string") {
      out.push({ kind: "R2 bucket", name: bucket.bucket_name });
    }
  }
  const queues = block.queues;
  if (isObject(queues)) {
    for (const producer of Array.isArray(queues.producers) ? queues.producers : []) {
      if (isObject(producer) && typeof producer.queue === "string") out.push({ kind: "queue", name: producer.queue });
    }
    for (const consumer of Array.isArray(queues.consumers) ? queues.consumers : []) {
      if (!isObject(consumer)) continue;
      if (typeof consumer.queue === "string") out.push({ kind: "queue consumer", name: consumer.queue });
      if (typeof consumer.dead_letter_queue === "string") {
        out.push({ kind: "dead-letter queue", name: consumer.dead_letter_queue });
      }
    }
  }
  return out;
}

function databaseIds(block: JsonObject): string[] {
  return field(block.d1_databases ?? [], "database_id");
}

function checkOwnResources(block: JsonObject, environment: EnvironmentName, label: string): string[] {
  const problems: string[] = [];
  const token = RESOURCE_TOKEN[environment];
  const pattern = new RegExp(`(^|-)${token}(-|$)`);
  for (const { kind, name } of resourceNames(block)) {
    if (!pattern.test(name))
      problems.push(`${label}: ${kind} "${name}" is not named for ${environment} (expected "${token}")`);
    for (const other of ENVIRONMENT_TOKENS.filter((t) => t !== token)) {
      if (new RegExp(`(^|-)${other}(-|$)`).test(name)) {
        problems.push(`${label}: ${kind} "${name}" is named for another environment ("${other}")`);
      }
    }
  }
  for (const db of field(block.d1_databases ?? [], "database_name")) {
    if (db !== EXPECTED_DATABASE_NAME[environment]) {
      problems.push(`${label}: D1 database "${db}" must be "${EXPECTED_DATABASE_NAME[environment]}"`);
    }
  }
  const vars = block.vars;
  const declared = isObject(vars) ? vars.ENVIRONMENT : undefined;
  if (declared !== environment) {
    problems.push(`${label}: vars.ENVIRONMENT is ${JSON.stringify(declared ?? null)}, expected "${environment}"`);
  }
  return problems;
}

function checkExplicitSafety(
  block: JsonObject,
  environment: RemoteEnvironmentName,
  worker: string,
  label: string,
): string[] {
  const problems: string[] = [];
  for (const key of MUST_BE_EXPLICIT) {
    if (block[key] === undefined) problems.push(`${label}: ${key} must be set explicitly (wrangler inherits it)`);
  }
  if (block.name !== undefined && block.name !== `${worker}-${environment}`) {
    problems.push(`${label}: name is ${JSON.stringify(block.name)}, expected "${worker}-${environment}"`);
  }
  if (block.workers_dev !== undefined && block.workers_dev !== false) {
    problems.push(`${label}: workers_dev must be false (a workers.dev URL bypasses Cloudflare Access and the zone)`);
  }
  if (block.preview_urls !== undefined && block.preview_urls !== false) {
    problems.push(`${label}: preview_urls must be false`);
  }
  const observability = block.observability;
  if (observability !== undefined && !(isObject(observability) && observability.enabled === true)) {
    problems.push(`${label}: observability.enabled must be true`);
  }
  return problems;
}

function checkRoutes(block: JsonObject, expectedPattern: string, label: string): string[] {
  const routes = block.routes;
  if (routes === undefined) return [];
  const ok =
    Array.isArray(routes) &&
    routes.length === 1 &&
    isObject(routes[0]) &&
    routes[0].pattern === expectedPattern &&
    routes[0].zone_name === ZONE_NAME &&
    routes[0].custom_domain === undefined;
  return ok ? [] : [`${label}: routes must be exactly [{ pattern: "${expectedPattern}", zone_name: "${ZONE_NAME}" }]`];
}

function checkNoSharedResources(config: JsonObject): string[] {
  const owners = new Map<string, string>();
  const problems: string[] = [];
  const blocks: [string, JsonObject][] = [["top level (local)", config]];
  for (const environment of REMOTE_ENVIRONMENTS) {
    const block = environmentBlock(config, environment);
    if (block !== undefined) blocks.push([`env.${environment}`, block]);
  }
  for (const [label, block] of blocks) {
    const names = resourceNames(block).map(({ name }) => name);
    const ids = databaseIds(block).filter((id) => !PLACEHOLDER_DATABASE_ID.test(id));
    for (const resource of new Set([...names, ...ids])) {
      const owner = owners.get(resource);
      if (owner !== undefined && owner !== label)
        problems.push(`${label} and ${owner} share the resource "${resource}"`);
      owners.set(resource, label);
    }
  }
  return problems;
}

export function checkApiConfig(config: JsonObject, options: CheckOptions = {}): string[] {
  const problems: string[] = [];

  if (config.routes !== undefined || config.route !== undefined) {
    problems.push(
      "top level: routes must not be declared at the top level (wrangler inherits them into every environment)",
    );
  }
  problems.push(...checkOwnResources(config, "local", "top level (local)"));

  const topBindings = bindingNames(config);
  for (const binding of REQUIRED_API_BINDINGS) {
    if (!topBindings.includes(binding)) problems.push(`top level (local): missing required binding ${binding}`);
  }

  for (const environment of REMOTE_ENVIRONMENTS) {
    const label = `env.${environment}`;
    const block = environmentBlock(config, environment);
    if (block === undefined) {
      problems.push(`${label} is missing`);
      continue;
    }
    problems.push(...checkExplicitSafety(block, environment, "mm-api", label));
    problems.push(...checkRoutes(block, `${HOSTNAME[environment]}/api/*`, label));
    problems.push(...checkRedeclared(config, block, label));
    problems.push(...checkOwnResources(block, environment, label));
    if (options.requireProvisioned === true) {
      for (const id of databaseIds(block)) {
        if (PLACEHOLDER_DATABASE_ID.test(id))
          problems.push(`${label}: D1 database_id is a placeholder; provision it first`);
      }
    }
  }

  problems.push(...checkNoSharedResources(config));
  return problems;
}

function bindingNames(block: JsonObject): string[] {
  return Object.entries(NON_INHERITABLE).flatMap(([key, names]) => {
    if (key === "vars" || key === "define" || key === "queues.consumers") return [];
    const value = read(block, key);
    return value === undefined ? [] : names(value);
  });
}

/** mm-site holds no bindings and no secrets: static assets and routes only. */
export function checkSiteConfig(config: JsonObject): string[] {
  const problems: string[] = [];
  if (config.routes !== undefined || config.route !== undefined) {
    problems.push("site top level: routes must not be declared at the top level");
  }
  const blocks: [string, JsonObject][] = [["site top level", config]];
  for (const environment of REMOTE_ENVIRONMENTS) {
    const label = `site env.${environment}`;
    const block = environmentBlock(config, environment);
    if (block === undefined) {
      problems.push(`${label} is missing`);
      continue;
    }
    blocks.push([label, block]);
    problems.push(...checkExplicitSafety(block, environment, "mm-site", label));
    problems.push(...checkRoutes(block, `${HOSTNAME[environment]}/*`, label));
    if (!isObject(block.assets)) problems.push(`${label}: assets must be declared explicitly`);
  }
  for (const [label, block] of blocks) {
    for (const key of Object.keys(NON_INHERITABLE)) {
      if (read(block, key) !== undefined)
        problems.push(`${label}: mm-site must not declare ${key}; mm-api owns every binding`);
    }
    if (block.main !== undefined) problems.push(`${label}: mm-site is assets-only and must not declare main`);
  }
  return problems;
}

/** Both Workers of an environment deploy to the same account. */
export function checkAccountsAgree(api: JsonObject, site: JsonObject): string[] {
  return REMOTE_ENVIRONMENTS.flatMap((environment) => {
    const apiAccount = environmentBlock(api, environment)?.account_id;
    const siteAccount = environmentBlock(site, environment)?.account_id;
    return apiAccount === siteAccount
      ? []
      : [
          `env.${environment}: mm-api and mm-site deploy to different accounts (${JSON.stringify(apiAccount ?? null)} vs ${JSON.stringify(siteAccount ?? null)})`,
        ];
  });
}
