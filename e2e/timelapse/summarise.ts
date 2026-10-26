// What a run found, from its steps.jsonl: the coverage matrix (each workflow's waves, the sim days it ran on, how
// often it passed, failed or healed) and every distinct fault, by its signature, with the day and wave it was first
// seen on and how often it came back. Written beside the run as coverage.json and faults.json.
//
//   node e2e/timelapse/summarise.ts

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OUT } from "./stack.ts";
import type { StepRecord } from "./steps.ts";

const records = readFileSync(join(OUT, "steps.jsonl"), "utf8")
  .trim()
  .split("\n")
  .filter((line) => line !== "")
  .map((line) => JSON.parse(line) as StepRecord);

interface Coverage {
  workflow: string;
  apps: Set<string>;
  modes: Set<string>;
  waves: Set<string>;
  days: Set<number>;
  passed: number;
  failed: number;
  healed: number;
}

const coverage = new Map<string, Coverage>();
for (const record of records) {
  const row = coverage.get(record.workflow) ?? {
    workflow: record.workflow,
    apps: new Set(),
    modes: new Set(),
    waves: new Set(),
    days: new Set(),
    passed: 0,
    failed: 0,
    healed: 0,
  };
  row.apps.add(record.app);
  row.modes.add(record.mode ?? "api");
  row.waves.add(record.wave);
  row.days.add(record.day);
  row[record.status] += 1;
  coverage.set(record.workflow, row);
}

/** A fault's signature: its kind, its route or screen, and its words with the run's own ids and figures taken out. */
function signature(kind: string, url: string | undefined, message: string): string {
  const words = message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/"request_id":"[^"]*"/g, "")
    .replace(/\d+/g, "#")
    .slice(0, 160);
  return `${kind} | ${(url ?? "").replace(/[0-9a-f-]{36}/gi, "<id>")} | ${words}`;
}

interface Fault {
  signature: string;
  workflow: string;
  app: string;
  firstDay: number;
  firstWave: string;
  firstSim: string;
  count: number;
  days: Set<number>;
  example: string;
}

const faults = new Map<string, Fault>();
for (const record of records) {
  for (const problem of record.problems) {
    const key = signature(problem.kind, problem.url, problem.message);
    const fault = faults.get(key) ?? {
      signature: key,
      workflow: record.workflow,
      app: problem.app ?? record.app,
      firstDay: record.day,
      firstWave: record.wave,
      firstSim: record.sim,
      count: 0,
      days: new Set(),
      example: problem.message,
    };
    fault.count += 1;
    fault.days.add(record.day);
    faults.set(key, fault);
  }
}

const ranges = (days: Set<number>): string => {
  const sorted = [...days].sort((one, two) => one - two);
  if (sorted.length <= 6) return sorted.join(", ");
  return `${sorted.slice(0, 3).join(", ")} … ${sorted.slice(-2).join(", ")} (${String(sorted.length)} days)`;
};

writeFileSync(
  join(OUT, "coverage.json"),
  JSON.stringify(
    [...coverage.values()].map((row) => ({
      workflow: row.workflow,
      apps: [...row.apps],
      modes: [...row.modes],
      waves: row.waves.size,
      days: ranges(row.days),
      passed: row.passed,
      failed: row.failed,
      healed: row.healed,
    })),
    null,
    2,
  ),
);
writeFileSync(
  join(OUT, "faults.json"),
  JSON.stringify(
    [...faults.values()]
      .sort((one, two) => one.firstDay - two.firstDay)
      .map((fault) => ({ ...fault, days: ranges(fault.days) })),
    null,
    2,
  ),
);
const totals = { steps: records.length, passed: 0, failed: 0, healed: 0 };
for (const record of records) totals[record.status] += 1;
console.log(JSON.stringify({ ...totals, workflows: coverage.size, faultSignatures: faults.size }));
