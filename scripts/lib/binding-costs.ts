// What mm-api's config may use, by what it costs on Workers Paid (docs/decisions/0194-the-build-on-workers-paid.md):
// a binding kind that bills by its use only once its cost is written down, and a CPU limit only within the plan's.

import type { JsonObject } from "./wrangler-config-check.ts";

/**
 * Binding kinds that bill by their use, past anything Workers Paid includes. One may be used once COST_NOTES says what
 * it costs and which record took it on. Every other kind may be used as it is; what the plan charges for D1, R2 and
 * Queues past its month is in docs/decisions/0112-workers-paid.md.
 */
const BILLED_BY_USE: readonly string[] = [
  "durable_objects.bindings",
  "workflows",
  "kv_namespaces",
  "analytics_engine_datasets",
  "vectorize",
  "pipelines",
  "dispatch_namespaces",
  "ai",
  "browser",
];

/** What each billed kind in use costs, and the record that took it on: none is used yet. */
const COST_NOTES: Readonly<Record<string, string>> = {};

/** The config key that bypasses wrangler's binding types. */
const UNCHECKED_KEY = "unsafe";

/** The most CPU an invocation may be given on Workers Paid: five minutes. */
const MOST_CPU_MS = 300_000;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The value at a dotted key, "durable_objects.bindings"; undefined where any part is missing. */
const read = (block: JsonObject, key: string): unknown =>
  key.split(".").reduce<unknown>((value, part) => (isObject(value) ? value[part] : undefined), block);

/** A binding kind that bills by its use only once its cost is written down; a CPU limit only within the plan's. */
export function checkBindingCosts(block: JsonObject, label: string): string[] {
  const problems: string[] = [];
  for (const key of BILLED_BY_USE) {
    if (read(block, key) !== undefined && COST_NOTES[key] === undefined) {
      problems.push(`${label}: ${key} bills by its use: write its cost in COST_NOTES first (docs/decisions/0194)`);
    }
  }
  if (block[UNCHECKED_KEY] !== undefined) problems.push(`${label}: ${UNCHECKED_KEY} is not allowed`);
  const { limits } = block;
  if (limits === undefined) return problems;
  const cpu = isObject(limits) ? limits.cpu_ms : undefined;
  const only = isObject(limits) && Object.keys(limits).every((name) => name === "cpu_ms");
  if (!only || typeof cpu !== "number" || cpu <= 0 || cpu > MOST_CPU_MS) {
    problems.push(`${label}: limits may set only cpu_ms, up to ${String(MOST_CPU_MS)} (docs/decisions/0194)`);
  }
  return problems;
}
