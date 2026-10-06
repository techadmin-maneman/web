// What scripts/release/release.ts does with a Worker's versions. Wrangler is handed in,
// so test/node/tooling/release.test.ts can answer as Cloudflare does.
//
// The deploy workflows decide nothing in shell: whether a Worker is deployed,
// what it serves, and what a rollback puts back are all answered here
// (docs/decisions/0006-deployment-pipeline.md).

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { ENABLED_SURFACES } from "../../src/config/environments.ts";
import { isConnectionLost, retryingLostReplies } from "./cloudflare-api.ts";
import type { WorkerEntry } from "./workers.ts";

export type Environment = "staging" | "production";

/** Runs wrangler against one Worker in one environment and returns what it printed. Throws as execFileSync does. */
export type Wrangler = (args: readonly string[], extraEnv?: Readonly<Record<string, string>>) => string;

/** The real wrangler, pointed at this Worker's config and environment. */
export function wranglerFor(worker: WorkerEntry, environment: Environment): Wrangler {
  return (args, extraEnv = {}) =>
    execFileSync(
      process.execPath,
      ["node_modules/wrangler/bin/wrangler.js", ...args, "--config", worker.config, "--env", environment],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...extraEnv } },
    );
}

export interface Target {
  readonly worker: WorkerEntry;
  readonly environment: Environment;
  readonly wrangler: Wrangler;
}

/** What `wrangler deployments status --json` prints. */
const DeploymentStatus = z.object({
  versions: z.array(z.object({ version_id: z.string(), percentage: z.number() })),
});
type Split = z.infer<typeof DeploymentStatus>["versions"];

/** The line wrangler writes to WRANGLER_OUTPUT_FILE_PATH after `versions upload`. */
const UploadOutput = z.object({ type: z.literal("version-upload"), version_id: z.string() });

/** What `wrangler versions list --json` prints, of which only the ID and the tag matter here. */
const VersionList = z.array(
  z.object({ id: z.string(), annotations: z.object({ "workers/tag": z.string().optional() }).optional() }),
);

/** Cloudflare's error code for "This Worker does not exist on your account". */
const WORKER_NOT_FOUND = "code: 10007";

function deployedName({ worker, environment }: Target): string {
  return `${worker.name}-${environment}`;
}

function stderrOf(error: unknown): string {
  return error instanceof Error && "stderr" in error ? String(error.stderr) : "";
}

/**
 * Whether the Worker must already be on the account. mm-api and mm-site serve
 * from their bootstrap on; an app's Worker must once its surface is switched on
 * (src/config/environments.ts), because its host then serves it. Only a Worker
 * that need not exist may read as never deployed.
 */
export function mustExist(worker: WorkerEntry, environment: Environment): boolean {
  if (worker.surface === undefined) return true;
  return ENABLED_SURFACES[environment].includes(worker.surface);
}

/** How traffic is split between versions now, or null where the Worker has never been deployed. */
function servingSplit(target: Target): Split | null {
  let output: string;
  try {
    // Reading changes nothing, so a dropped reply is simply asked again.
    output = retryingLostReplies(`${deployedName(target)} status`, () =>
      target.wrangler(["deployments", "status", "--json"]),
    );
  } catch (error) {
    if (stderrOf(error).includes(WORKER_NOT_FOUND)) return null;
    throw error;
  }
  return DeploymentStatus.parse(JSON.parse(output)).versions;
}

/**
 * The version serving all traffic, or "" for an app whose surface is not switched on there (see mustExist).
 * Such an app is left alone whether or not it was ever deployed: its host serves nothing yet, and its
 * production build refuses copy still owed (scripts/lib/content-gate.ts), so shipping it would fail a
 * release that did not need it. `mm-app-production` was bootstrapped before its surface was switched on.
 */
export function currentVersion(target: Target): string {
  if (!mustExist(target.worker, target.environment)) return "";
  const split = servingSplit(target);
  if (split === null) {
    throw new Error(
      `${deployedName(target)} is not on the account, but it serves a host there; check the token and the account (docs/runbook.md)`,
    );
  }

  const serving = split.find((version) => version.percentage === 100);
  if (serving === undefined) {
    const shares = split.map((version) => `${version.version_id}@${String(version.percentage)}%`).join(", ");
    throw new Error(`${deployedName(target)} is mid-rollout (${shares}); finish or roll it back first`);
  }
  return serving.version_id;
}

/** The newest version carrying this tag, or null where the upload really did not land. */
function versionTagged(target: Target, tag: string): string | null {
  const output = retryingLostReplies(`${deployedName(target)} versions`, () =>
    target.wrangler(["versions", "list", "--json"]),
  );
  const versions = VersionList.parse(JSON.parse(output));
  const tagged = versions.filter((version) => version.annotations?.["workers/tag"] === tag);
  return tagged.at(-1)?.id ?? null;
}

/** Uploads a new version without sending it any traffic, and returns its ID. */
export function uploadVersion(target: Target, tag: string, message: string): string {
  const outputFile = join(mkdtempSync(join(tmpdir(), "wrangler-")), "output.ndjson");
  // The commit, baked into the bundle as BUILD_SHA: a secret change publishes an untagged version of the same code, and
  // /api/health still says which commit is live (src/routes/health.ts). A define adds no binding to mm-api's 64.
  const commit = COMMIT.test(tag) ? ["--define", `BUILD_SHA:"${tag}"`] : [];
  try {
    target.wrangler(["versions", "upload", "--tag", tag, "--message", message, ...commit], {
      WRANGLER_OUTPUT_FILE_PATH: outputFile,
    });
  } catch (error) {
    // Uploading twice would make two versions, so ask what landed instead.
    if (!isConnectionLost(error)) throw error;
    const uploaded = versionTagged(target, tag);
    if (uploaded === null) throw error;
    console.error(`${deployedName(target)}: Cloudflare's reply was lost; the upload is on the account`);
    return uploaded;
  }

  for (const line of readFileSync(outputFile, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    const parsed = UploadOutput.safeParse(JSON.parse(line));
    if (parsed.success) return parsed.data.version_id;
  }
  throw new Error("wrangler did not report the uploaded version");
}

/** A git commit's SHA, as the deploy workflows tag a version with it. */
const COMMIT = /^[0-9a-f]{7,40}$/;

/** Sets how traffic is split between versions, e.g. ["<id>@10", "<id>@90"]. The shares must total 100. */
export function deploySplit(target: Target, splits: readonly string[], message: string): void {
  const valid = splits.every((split) => /^[0-9a-f-]{36}@\d{1,3}$/.test(split));
  const total = splits.reduce((sum, split) => sum + Number(split.split("@")[1]), 0);
  if (splits.length === 0 || !valid || total !== 100) {
    throw new Error(`--split must be <version-id>@<percent>, totalling 100; got: ${splits.join(" ")}`);
  }
  try {
    target.wrangler(["versions", "deploy", ...splits, "--yes", "--message", message]);
  } catch (error) {
    // The same lost reply: the split may already be live, so ask what is serving before failing.
    const wanted = splits.length === 1 ? (splits[0]?.split("@")[0] ?? "") : "";
    if (!isConnectionLost(error) || wanted === "" || currentVersion(target) !== wanted) throw error;
    console.error(`${deployedName(target)}: Cloudflare's reply was lost; the version is already serving`);
  }
  console.error(`${deployedName(target)}: ${splits.join(", ")}`);
}

/**
 * Uploads a version and sends it all traffic, returning its ID. An app whose
 * surface is not switched on there is left alone: null. Its first deploy is a
 * bootstrap (docs/runbook.md, step 11).
 */
export function ship(target: Target, tag: string, message: string): string | null {
  if (currentVersion(target) === "") return null;
  const version = uploadVersion(target, tag, message);
  deploySplit(target, [`${version}@100`], message);
  return version;
}

export type Restored = "restored" | "unchanged" | "nothing to restore";

/**
 * Puts back the version recorded before a release, at 100%, whatever the
 * release left serving: a canary split, or an app whose deploy failed after its
 * new version went live. "" is a Worker that had no version before the release.
 */
export function restore(target: Target, version: string, message: string): Restored {
  if (version === "") return "nothing to restore";
  const split = servingSplit(target);
  const alreadyServing = split?.length === 1 && split[0]?.version_id === version && split[0].percentage === 100;
  if (alreadyServing) return "unchanged";
  deploySplit(target, [`${version}@100`], message);
  return "restored";
}
