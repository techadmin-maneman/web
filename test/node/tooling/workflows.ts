// The GitHub workflows as GitHub reads them, parsed (.github/workflows/*.yml), for the tests that hold them to what
// they must do: jobs and their conditions, steps in order, and a step's own script run in bash with the commands it
// calls faked, so a test checks what the step does rather than how its text is spelt.

import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse } from "yaml";

export interface Step {
  readonly name?: string;
  readonly id?: string;
  readonly if?: string;
  readonly run?: string;
  readonly uses?: string;
  readonly with?: Readonly<Record<string, unknown>>;
  readonly env?: Readonly<Record<string, string>>;
  readonly "continue-on-error"?: boolean;
}

export interface Job {
  readonly name?: string;
  readonly needs?: string | readonly string[];
  readonly if?: string;
  readonly "runs-on"?: string;
  readonly uses?: string;
  readonly outputs?: Readonly<Record<string, string>>;
  readonly strategy?: { readonly matrix?: Readonly<Record<string, unknown>> };
  readonly permissions?: string | Readonly<Record<string, string>>;
  readonly steps?: readonly Step[];
}

export interface Workflow {
  readonly on: unknown;
  readonly permissions?: string | Readonly<Record<string, string>>;
  readonly jobs: Readonly<Record<string, Job>>;
}

export const WORKFLOW_FILES = readdirSync(".github/workflows").filter((file) => /\.ya?ml$/.test(file));

export const workflow = (file: string): Workflow =>
  parse(readFileSync(`.github/workflows/${file}`, "utf8")) as Workflow;

export function jobOf(flow: Workflow, key: string): Job {
  const job = flow.jobs[key];
  if (job === undefined) throw new Error(`no job ${key}`);
  return job;
}

export const needsOf = (job: Job): string[] => (job.needs === undefined ? [] : [job.needs].flat());

/** The job's step of that name. */
export function stepOf(job: Job, name: string): Step {
  const step = job.steps?.find((each) => each.name === name);
  if (step === undefined) throw new Error(`no step "${name}"`);
  return step;
}

/** Where in the job's steps the first whose script `includes` that text runs; -1 where none does. */
export const placeOf = (job: Job, includes: string): number =>
  job.steps?.findIndex((step) => step.run?.includes(includes) === true) ?? -1;

/** Every step of every job, with where it is. */
export function allSteps(flow: Workflow): { job: string; step: Step }[] {
  return Object.entries(flow.jobs).flatMap(([job, each]) => (each.steps ?? []).map((step) => ({ job, step })));
}

export interface Ran {
  readonly status: number | null;
  readonly output: string;
  /** What the step wrote to $GITHUB_OUTPUT, by name. */
  readonly outputs: Readonly<Record<string, string>>;
  /** Each faked command's arguments, a call a line. */
  readonly calls: Readonly<Record<string, readonly string[]>>;
}

/**
 * Runs a step's script in bash, as a runner would, with `fakes` in place of the commands of those names: each fake is
 * a bash body, run with the call's arguments, whose calls are recorded.
 */
export function runStep(step: Step, fakes: Readonly<Record<string, string>>, env: Record<string, string> = {}): Ran {
  const scratch = mkdtempSync(path.join(tmpdir(), "mm-step-"));
  try {
    const bin = path.join(scratch, "bin");
    writeFileSync(path.join(scratch, "outputs"), "");
    mkdirSync(bin);
    for (const [command, body] of Object.entries(fakes)) {
      const fake = path.join(bin, command);
      writeFileSync(fake, `#!/usr/bin/env bash\necho "$*" >> "${scratch}/${command}.calls"\n${body}\n`);
      chmodSync(fake, 0o755);
    }
    writeFileSync(path.join(scratch, "step.sh"), `set -eo pipefail\n${step.run ?? ""}`);
    const ran = spawnSync("bash", [path.join(scratch, "step.sh")], {
      cwd: scratch,
      encoding: "utf8",
      env: {
        ...process.env,
        ...env,
        PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
        GITHUB_OUTPUT: path.join(scratch, "outputs"),
      },
    });
    const read = (file: string) => {
      try {
        return readFileSync(path.join(scratch, file), "utf8");
      } catch {
        return "";
      }
    };
    const outputs = Object.fromEntries(
      read("outputs")
        .split("\n")
        .filter((line) => line.includes("="))
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
    );
    const calls = Object.fromEntries(
      Object.keys(fakes).map((command) => [command, read(`${command}.calls`).split("\n").filter(Boolean)]),
    );
    return { status: ran.status, output: `${ran.stdout}${ran.stderr}`, outputs, calls };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
