// Rules that keep staging and production isolated in the wrangler configs.
// Each check returns a list of problems; an empty list means the config is
// fine. See docs/decisions/0005-environment-isolation-in-wrangler-config.md.

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
 * How to find binding names under a config key:
 * "list": an array of bindings, each named by `nameField`.
 * "one":  a single binding object, named by `nameField`.
 * "map":  an object whose keys are the names, like `vars`.
 */
type BindingKey =
  | { readonly key: string; readonly shape: "list" | "one"; readonly nameField: string }
  | { readonly key: string; readonly shape: "map" };

/**
 * Config keys that wrangler does NOT copy from the top level into an
 * environment. If the top level declares one and an environment does not, that
 * environment runs without the binding.
 */
const NON_INHERITABLE_KEYS: readonly BindingKey[] = [
  { key: "vars", shape: "map" },
  { key: "define", shape: "map" },
  { key: "d1_databases", shape: "list", nameField: "binding" },
  { key: "r2_buckets", shape: "list", nameField: "binding" },
  { key: "kv_namespaces", shape: "list", nameField: "binding" },
  { key: "queues.producers", shape: "list", nameField: "binding" },
  { key: "queues.consumers", shape: "list", nameField: "queue" },
  { key: "durable_objects.bindings", shape: "list", nameField: "name" },
  { key: "services", shape: "list", nameField: "binding" },
  { key: "hyperdrive", shape: "list", nameField: "binding" },
  { key: "vectorize", shape: "list", nameField: "binding" },
  { key: "analytics_engine_datasets", shape: "list", nameField: "binding" },
  { key: "dispatch_namespaces", shape: "list", nameField: "binding" },
  { key: "mtls_certificates", shape: "list", nameField: "binding" },
  { key: "secrets_store_secrets", shape: "list", nameField: "binding" },
  { key: "workflows", shape: "list", nameField: "binding" },
  { key: "pipelines", shape: "list", nameField: "binding" },
  { key: "send_email", shape: "list", nameField: "name" },
  { key: "ratelimits", shape: "list", nameField: "name" },
  { key: "tail_consumers", shape: "list", nameField: "service" },
  { key: "version_metadata", shape: "one", nameField: "binding" },
  { key: "ai", shape: "one", nameField: "binding" },
  { key: "browser", shape: "one", nameField: "binding" },
  { key: "images", shape: "one", nameField: "binding" },
];

/**
 * Config keys that wrangler DOES copy into every environment. For a remote
 * environment each must be set in its own block, or it could inherit a route
 * or an account meant for local.
 */
const MUST_BE_EXPLICIT = ["name", "account_id", "workers_dev", "preview_urls", "observability", "routes"] as const;

export const REQUIRED_API_BINDINGS = [
  "DB",
  "UPLOADS",
  "RESULTS",
  "RENDER_QUEUE",
  "CRM_QUEUE",
  "MESSAGE_QUEUE",
  "CF_VERSION_METADATA",
] as const;

/** `wrangler d1 create` has not been run yet. */
export const PLACEHOLDER_DATABASE_ID = "00000000-0000-0000-0000-000000000000";

const ENVIRONMENT_TOKENS: readonly string[] = Object.values(RESOURCE_TOKEN);

export interface CheckOptions {
  /** Used before a deploy: reject placeholder database IDs. */
  readonly requireProvisioned?: boolean;
}

// ---------------------------------------------------------------------------
// Reading the parsed config
// ---------------------------------------------------------------------------

function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Follows a dotted path such as "queues.producers". */
function read(config: JsonObject, path: string): Json | undefined {
  let current: Json | undefined = config;
  for (const part of path.split(".")) {
    if (!isObject(current)) return undefined;
    current = current[part];
  }
  return current;
}

/** The objects in an array, ignoring anything else. */
function objectsIn(value: Json | undefined): JsonObject[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function stringField(object: JsonObject, field: string): string | undefined {
  const value = object[field];
  return typeof value === "string" ? value : undefined;
}

function environmentBlock(config: JsonObject, environment: string): JsonObject | undefined {
  const envs = config.env;
  if (!isObject(envs)) return undefined;
  const block = envs[environment];
  return isObject(block) ? block : undefined;
}

/** The binding names declared under one key, e.g. ["DB"] for d1_databases. */
function namesUnder(block: JsonObject, bindingKey: BindingKey): string[] | undefined {
  const value = read(block, bindingKey.key);
  if (value === undefined) return undefined;
  if (bindingKey.shape === "map") return isObject(value) ? Object.keys(value) : [];

  let bindings: JsonObject[] = [];
  if (bindingKey.shape === "list") bindings = objectsIn(value);
  else if (isObject(value)) bindings = [value];
  return bindings.flatMap((binding) => stringField(binding, bindingKey.nameField) ?? []);
}

/** "mm-render-staging" and "mm-render-prod" both become "mm-render-{env}". */
function withoutEnvironmentToken(name: string): string {
  return name
    .split("-")
    .map((part) => (ENVIRONMENT_TOKENS.includes(part) ? "{env}" : part))
    .join("-");
}

function sameNames(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a.map(withoutEnvironmentToken));
  const right = new Set(b.map(withoutEnvironmentToken));
  return left.size === right.size && [...left].every((name) => right.has(name));
}

interface Resource {
  readonly kind: string;
  readonly name: string;
}

/** Every named resource a block points at: databases, buckets, queues. */
function resourcesOf(block: JsonObject): Resource[] {
  const resources: Resource[] = [];
  const add = (kind: string, name: string | undefined): void => {
    if (name !== undefined) resources.push({ kind, name });
  };
  for (const db of objectsIn(block.d1_databases)) add("D1 database", stringField(db, "database_name"));
  for (const bucket of objectsIn(block.r2_buckets)) add("R2 bucket", stringField(bucket, "bucket_name"));
  for (const producer of objectsIn(read(block, "queues.producers"))) add("queue", stringField(producer, "queue"));
  for (const consumer of objectsIn(read(block, "queues.consumers"))) {
    add("queue consumer", stringField(consumer, "queue"));
    add("dead-letter queue", stringField(consumer, "dead_letter_queue"));
  }
  return resources;
}

function databaseIds(block: JsonObject): string[] {
  return objectsIn(block.d1_databases).flatMap((db) => stringField(db, "database_id") ?? []);
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/** Every non-inheritable key at the top level is redeclared with the same binding names. */
function checkRedeclared(top: JsonObject, block: JsonObject, label: string): string[] {
  const problems: string[] = [];
  for (const bindingKey of NON_INHERITABLE_KEYS) {
    const topNames = namesUnder(top, bindingKey);
    const envNames = namesUnder(block, bindingKey);
    const { key } = bindingKey;

    if (topNames === undefined && envNames === undefined) continue;
    if (envNames === undefined) {
      problems.push(`${label}: ${key} is not redeclared (the top level declares ${(topNames ?? []).join(", ")})`);
    } else if (topNames === undefined) {
      problems.push(`${label}: declares ${key}, which the top level (local) does not`);
    } else if (!sameNames(topNames, envNames)) {
      problems.push(
        `${label}: ${key} declares [${envNames.join(", ")}] but the top level declares [${topNames.join(", ")}]`,
      );
    }
  }
  if (top.triggers !== undefined && block.triggers === undefined) {
    problems.push(`${label}: triggers is inherited from the top level; declare it explicitly`);
  }
  return problems;
}

/** A block names only its own environment's resources, and its ENVIRONMENT var matches. */
function checkOwnResources(block: JsonObject, environment: EnvironmentName, label: string): string[] {
  const problems: string[] = [];
  const token = RESOURCE_TOKEN[environment];

  for (const { kind, name } of resourcesOf(block)) {
    const parts = name.split("-");
    if (!parts.includes(token)) {
      problems.push(`${label}: ${kind} "${name}" is not named for ${environment} (expected "${token}")`);
    }
    for (const other of ENVIRONMENT_TOKENS) {
      if (other !== token && parts.includes(other)) {
        problems.push(`${label}: ${kind} "${name}" is named for another environment ("${other}")`);
      }
    }
  }

  const expectedDatabase = EXPECTED_DATABASE_NAME[environment];
  for (const { kind, name } of resourcesOf(block)) {
    if (kind === "D1 database" && name !== expectedDatabase) {
      problems.push(`${label}: D1 database "${name}" must be "${expectedDatabase}"`);
    }
  }

  const declared = read(block, "vars.ENVIRONMENT");
  if (declared !== environment) {
    problems.push(`${label}: vars.ENVIRONMENT is ${JSON.stringify(declared ?? null)}, expected "${environment}"`);
  }
  return problems;
}

/** The keys wrangler would otherwise inherit are set, and set safely. */
function checkInheritableKeys(
  block: JsonObject,
  environment: RemoteEnvironmentName,
  worker: string,
  label: string,
): string[] {
  const problems: string[] = [];
  for (const key of MUST_BE_EXPLICIT) {
    if (block[key] === undefined) problems.push(`${label}: ${key} must be set explicitly (wrangler inherits it)`);
  }
  const expectedName = `${worker}-${environment}`;
  if (block.name !== undefined && block.name !== expectedName) {
    problems.push(`${label}: name is ${JSON.stringify(block.name)}, expected "${expectedName}"`);
  }
  if (block.workers_dev !== undefined && block.workers_dev !== false) {
    problems.push(`${label}: workers_dev must be false (a workers.dev URL bypasses Cloudflare Access and the zone)`);
  }
  if (block.preview_urls !== undefined && block.preview_urls !== false) {
    problems.push(`${label}: preview_urls must be false`);
  }
  if (block.observability !== undefined && read(block, "observability.enabled") !== true) {
    problems.push(`${label}: observability.enabled must be true`);
  }
  return problems;
}

/** Exactly one route: the expected pattern on the maneman.in zone. */
function checkRoutes(block: JsonObject, expectedPattern: string, label: string): string[] {
  if (block.routes === undefined) return []; // reported by checkInheritableKeys

  const routes = Array.isArray(block.routes) ? block.routes : [];
  const [route] = objectsIn(routes);
  const ok =
    routes.length === 1 &&
    route?.pattern === expectedPattern &&
    route.zone_name === ZONE_NAME &&
    route.custom_domain === undefined;
  return ok ? [] : [`${label}: routes must be exactly [{ pattern: "${expectedPattern}", zone_name: "${ZONE_NAME}" }]`];
}

/** No bucket, queue, database name or database ID appears in two environments. */
function checkNoSharedResources(config: JsonObject): string[] {
  const blocks: [string, JsonObject][] = [["top level (local)", config]];
  for (const environment of REMOTE_ENVIRONMENTS) {
    const block = environmentBlock(config, environment);
    if (block !== undefined) blocks.push([`env.${environment}`, block]);
  }

  const ownerOf = new Map<string, string>();
  const problems: string[] = [];
  for (const [label, block] of blocks) {
    const names = resourcesOf(block).map((resource) => resource.name);
    const ids = databaseIds(block).filter((id) => id !== PLACEHOLDER_DATABASE_ID);
    for (const resource of new Set([...names, ...ids])) {
      const owner = ownerOf.get(resource);
      if (owner !== undefined && owner !== label) {
        problems.push(`${label} and ${owner} share the resource "${resource}"`);
      }
      ownerOf.set(resource, label);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

export function checkApiConfig(config: JsonObject, options: CheckOptions = {}): string[] {
  const problems: string[] = [];

  if (config.routes !== undefined || config.route !== undefined) {
    problems.push(
      "top level: routes must not be declared at the top level (wrangler inherits them into every environment)",
    );
  }
  problems.push(...checkOwnResources(config, "local", "top level (local)"));

  const localBindings = NON_INHERITABLE_KEYS.flatMap((bindingKey) => namesUnder(config, bindingKey) ?? []);
  for (const binding of REQUIRED_API_BINDINGS) {
    if (!localBindings.includes(binding)) problems.push(`top level (local): missing required binding ${binding}`);
  }

  for (const environment of REMOTE_ENVIRONMENTS) {
    const label = `env.${environment}`;
    const block = environmentBlock(config, environment);
    if (block === undefined) {
      problems.push(`${label} is missing`);
      continue;
    }
    problems.push(...checkInheritableKeys(block, environment, "mm-api", label));
    problems.push(...checkRoutes(block, `${HOSTNAME[environment]}/api/*`, label));
    problems.push(...checkRedeclared(config, block, label));
    problems.push(...checkOwnResources(block, environment, label));
    if (options.requireProvisioned === true && databaseIds(block).includes(PLACEHOLDER_DATABASE_ID)) {
      problems.push(`${label}: D1 database_id is a placeholder; provision it first`);
    }
  }

  problems.push(...checkNoSharedResources(config));
  return problems;
}

/** mm-site is static assets and routes only: no bindings, no code. */
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
    problems.push(...checkInheritableKeys(block, environment, "mm-site", label));
    problems.push(...checkRoutes(block, `${HOSTNAME[environment]}/*`, label));
    if (!isObject(block.assets)) problems.push(`${label}: assets must be declared explicitly`);
  }

  for (const [label, block] of blocks) {
    for (const { key } of NON_INHERITABLE_KEYS) {
      if (read(block, key) !== undefined) {
        problems.push(`${label}: mm-site must not declare ${key}; mm-api owns every binding`);
      }
    }
    if (block.main !== undefined) problems.push(`${label}: mm-site is assets-only and must not declare main`);
  }
  return problems;
}

/** Both Workers of an environment deploy to the same Cloudflare account. */
export function checkAccountsAgree(api: JsonObject, site: JsonObject): string[] {
  const problems: string[] = [];
  for (const environment of REMOTE_ENVIRONMENTS) {
    const apiAccount = environmentBlock(api, environment)?.account_id ?? null;
    const siteAccount = environmentBlock(site, environment)?.account_id ?? null;
    if (apiAccount !== siteAccount) {
      problems.push(
        `env.${environment}: mm-api and mm-site deploy to different accounts (${JSON.stringify(apiAccount)} vs ${JSON.stringify(siteAccount)})`,
      );
    }
  }
  return problems;
}
