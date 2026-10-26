// The API's own log, read after each cron run and each wave: a job that failed, an error line, a request the runtime
// cancelled. What the Worker says about itself is a finding even when every screen looked right.

import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { OUT } from "./stack.ts";
import type { Steps } from "./steps.ts";

const FILE = join(OUT, "api.log");
let readTo = 0;

/** The runtime's "code had hung" cancellations: each nightly Workflow start makes one locally, counted apart. */
export const hung = { count: 0 };

/** Lines that are the local stack's own talk, not the product's. */
const QUIET = [/^\s*$/, /wrangler:info/, /Ready on/, /\[wrangler/, /⎔|╭|╰|│/];

export function readWorkerLog(steps: Steps): { cronFailures: string[]; errors: number } {
  if (!existsSync(FILE)) return { cronFailures: [], errors: 0 };
  const size = statSync(FILE).size;
  if (size <= readTo) return { cronFailures: [], errors: 0 };
  const buffer = Buffer.alloc(size - readTo);
  const handle = openSync(FILE, "r");
  readSync(handle, buffer, 0, buffer.length, readTo);
  closeSync(handle);
  readTo = size;
  const cronFailures: string[] = [];
  let errors = 0;
  // ANSI colours off, so the JSON inside a coloured line can be read.
  for (const line of buffer
    .toString("utf8")
    .replace(/\[[0-9;]*m/g, "")
    .split("\n")) {
    if (QUIET.some((pattern) => pattern.test(line))) continue;
    const json = line.indexOf("{");
    let entry: Record<string, unknown> | null = null;
    if (json >= 0) {
      try {
        entry = JSON.parse(line.slice(json)) as Record<string, unknown>;
      } catch {
        entry = null;
      }
    }
    if (entry !== null) {
      const failed = entry.failed_jobs;
      if (entry.event === "cron_run" && Array.isArray(failed) && failed.length > 0) {
        cronFailures.push(...failed.map(String));
        steps.report({ kind: "cron", app: "worker", message: `cron jobs failed: ${failed.map(String).join(", ")}` });
      }
      if (entry.level === "error") {
        errors += 1;
        const { event, job, route, error } = entry as { event?: string; job?: string; route?: string; error?: unknown };
        steps.report({
          kind: "worker",
          app: "worker",
          url: route ?? job,
          message: `${String(event)} ${job === undefined ? "" : `job=${job} `}${JSON.stringify(error ?? entry).slice(0, 500)}`,
        });
      }
      continue;
    }
    if (line.includes("detected that your Worker's code had hung")) {
      hung.count += 1;
      continue;
    }
    if (/Uncaught|ERROR|Error:/.test(line)) {
      errors += 1;
      steps.report({ kind: "worker", app: "worker", message: line.trim().slice(0, 500) });
    }
  }
  return { cronFailures, errors };
}
