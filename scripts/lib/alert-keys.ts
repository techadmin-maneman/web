// The alert keys the code raises (src/domain/ops/alerts.ts), found in its source, and the keys the runbook's table of
// alerts names (docs/runbook/alerts.md, "What each alert means"). Each is a key's fixed start: "cron_job" for
// `cron_job:${job}`. test/node/tooling/runbook-alerts.test.ts holds the two to each other.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** What follows "key:" in a type, never a key. */
const TYPE_NAMES = new Set(["string", "number", "boolean"]);

/** A key's fixed start: up to its first ":" or interpolation, as "payment_link" for `payment_link:${visit}`. */
const prefixOf = (key: string): string => key.split(/[:$<]/)[0] ?? key;

function sourcesUnder(dir: string): { path: string; text: string }[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourcesUnder(path);
    return path.endsWith(".ts") ? [{ path, text: readFileSync(path, "utf8") }] : [];
  });
}

/**
 * Every key an alert is raised under: a literal or template given as `key:`, or a constant or helper given there
 * whose own definition starts with the key, as `lowStockKey` does.
 */
export function raisedKeys(srcDir = "src"): string[] {
  const sources = sourcesUnder(srcDir);
  const all = sources.map((source) => source.text).join("\n");
  const keys = new Set<string>();
  for (const { text } of sources) {
    for (const [, literal] of text.matchAll(/\bkey:\s*["`]([a-z][a-z0-9_]*)/g)) keys.add(prefixOf(literal ?? ""));
    for (const [, name] of text.matchAll(/\bkey:\s*([A-Za-z_][A-Za-z0-9_]*)\s*[(,}]/g)) {
      if (name === undefined || TYPE_NAMES.has(name)) continue;
      const defined = new RegExp(
        String.raw`\b${name}\b\s*=\s*(?:\([^)]*\)[^=]*=>\s*)?(?:[^"\x60]*\?\s*)?["\x60]([a-z][a-z0-9_]*)`,
      ).exec(all);
      if (defined?.[1] !== undefined) keys.add(prefixOf(defined[1]));
    }
  }
  return [...keys].sort();
}

/** Every key the runbook's table of alerts names, by its fixed start. */
export function documentedKeys(runbook: string): string[] {
  const start = runbook.indexOf("## What each alert means");
  const next = runbook.indexOf("\n## ", start + 1);
  const table = runbook.slice(start, next === -1 ? undefined : next);
  const keys = new Set<string>();
  for (const row of table.split("\n").filter((line) => line.startsWith("| "))) {
    const cell = row.split("|")[2] ?? "";
    for (const [, key] of cell.matchAll(/`([a-z][a-z0-9_]*)[^`]*`/g)) keys.add(prefixOf(key ?? ""));
  }
  return [...keys].sort();
}
