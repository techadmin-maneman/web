import type { Json, JsonObject } from "../../scripts/lib/wrangler-config-check.ts";

export const DELETE = Symbol("delete");
/** A dotted path (numeric parts index arrays) and the value to put there. */
export type Edit = readonly [path: string, value: Json | typeof DELETE];

/** A deep copy of `config` with each edit applied; DELETE removes the key or array item. */
export function edited(config: JsonObject, ...edits: readonly Edit[]): JsonObject {
  const copy = structuredClone(config);
  for (const [path, value] of edits) {
    const parts = path.split(".");
    const last = parts.pop();
    if (last === undefined) throw new Error("empty path");
    let node: Json = copy;
    for (const part of parts) {
      const next: Json | undefined = Array.isArray(node) ? node[Number(part)] : isObject(node) ? node[part] : undefined;
      if (next === undefined) throw new Error(`no ${part} in ${path}`);
      node = next;
    }
    if (Array.isArray(node)) {
      if (value === DELETE) node.splice(Number(last), 1);
      else node[Number(last)] = value;
    } else if (isObject(node)) {
      if (value === DELETE) Reflect.deleteProperty(node, last);
      else node[last] = value;
    } else {
      throw new Error(`cannot edit ${path}`);
    }
  }
  return copy;
}

function isObject(value: Json): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
