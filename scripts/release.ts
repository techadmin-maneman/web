// Worker version bookkeeping for the deploy workflows.
//
//   node scripts/release.ts current --worker mm-api --env production
//       Prints the version serving 100% of traffic, or "" if the Worker has
//       never been deployed.
//   node scripts/release.ts upload --worker mm-api --env production --tag <git-sha>
//       Uploads a new version without sending it any traffic. Prints its ID.
//   node scripts/release.ts deploy --worker mm-api --env production --split <id>@10 --split <id>@90
//       Sets how traffic is split between versions. Percentages must total 100.
//
// See docs/decisions/0006-deployment-pipeline.md.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";

const CONFIG_FILE = { "mm-api": "wrangler.jsonc", "mm-site": "site/wrangler.jsonc" } as const;
type Worker = keyof typeof CONFIG_FILE;
type Environment = "staging" | "production";

/** What `wrangler deployments status --json` prints. */
const DeploymentStatus = z.object({
  versions: z.array(z.object({ version_id: z.string(), percentage: z.number() })),
});

/** The line wrangler writes to WRANGLER_OUTPUT_FILE_PATH after `versions upload`. */
const UploadOutput = z.object({ type: z.literal("version-upload"), version_id: z.string() });

/** Cloudflare's error code for "This Worker does not exist on your account". */
const WORKER_NOT_FOUND = "code: 10007";

function wrangler(worker: Worker, environment: Environment, args: string[], extraEnv: Record<string, string> = {}) {
  return execFileSync(
    process.execPath,
    ["node_modules/wrangler/bin/wrangler.js", ...args, "--config", CONFIG_FILE[worker], "--env", environment],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...extraEnv } },
  );
}

function currentVersion(worker: Worker, environment: Environment): string {
  let output: string;
  try {
    output = wrangler(worker, environment, ["deployments", "status", "--json"]);
  } catch (error) {
    const stderr = error instanceof Error && "stderr" in error ? String(error.stderr) : "";
    if (stderr.includes(WORKER_NOT_FOUND)) return "";
    throw error;
  }

  const { versions } = DeploymentStatus.parse(JSON.parse(output));
  const serving = versions.find((version) => version.percentage === 100);
  if (serving === undefined) {
    const split = versions.map((version) => `${version.version_id}@${String(version.percentage)}%`).join(", ");
    throw new Error(`${worker} ${environment} is mid-rollout (${split}); finish or roll it back first`);
  }
  return serving.version_id;
}

function uploadVersion(worker: Worker, environment: Environment, tag: string, message: string): string {
  const outputFile = join(mkdtempSync(join(tmpdir(), "wrangler-")), "output.ndjson");
  wrangler(worker, environment, ["versions", "upload", "--tag", tag, "--message", message], {
    WRANGLER_OUTPUT_FILE_PATH: outputFile,
  });

  for (const line of readFileSync(outputFile, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    const parsed = UploadOutput.safeParse(JSON.parse(line));
    if (parsed.success) return parsed.data.version_id;
  }
  throw new Error("wrangler did not report the uploaded version");
}

function deploySplit(worker: Worker, environment: Environment, splits: string[], message: string): void {
  const valid = splits.every((split) => /^[0-9a-f-]{36}@\d{1,3}$/.test(split));
  const total = splits.reduce((sum, split) => sum + Number(split.split("@")[1]), 0);
  if (splits.length === 0 || !valid || total !== 100) {
    throw new Error(`--split must be <version-id>@<percent>, totalling 100; got: ${splits.join(" ")}`);
  }
  wrangler(worker, environment, ["versions", "deploy", ...splits, "--yes", "--message", message]);
  console.error(`${worker} ${environment}: ${splits.join(", ")}`);
}

// ---------------------------------------------------------------------------

function usage(): never {
  console.error("usage: release.ts <current|upload|deploy> --worker <mm-api|mm-site> --env <staging|production> …");
  process.exit(2);
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    worker: { type: "string" },
    env: { type: "string" },
    tag: { type: "string" },
    message: { type: "string" },
    split: { type: "string", multiple: true },
  },
});

const worker = values.worker;
const environment = values.env;
if (worker !== "mm-api" && worker !== "mm-site") usage();
if (environment !== "staging" && environment !== "production") usage();

const command = positionals[0] ?? "";
switch (command) {
  case "current":
    console.log(currentVersion(worker, environment));
    break;
  case "upload": {
    const tag = values.tag ?? usage();
    console.log(uploadVersion(worker, environment, tag, values.message ?? `release ${tag}`));
    break;
  }
  case "deploy": {
    const splits = values.split ?? [];
    deploySplit(worker, environment, splits, values.message ?? `split ${splits.join(" ")}`);
    break;
  }
  default:
    usage();
}
