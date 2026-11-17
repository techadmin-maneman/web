// Source maps in Sentry for what a deploy ships, so an error's frames read as our source (docs/runbook/alerts.md,
// point 4). mm-api reports its own errors, and the apps' through it, under its version's tag, the commit's SHA
// (src/index.ts), so each map goes up under that release (scripts/lib/sentry-maps.ts). Each app's maps are then
// deleted from its build, so none is served.
//
//   node scripts/release/sentry-maps.ts --env staging --release <sha> --worker <bundle dir> --app <build dir> …
//
// SENTRY_AUTH_TOKEN, a Sentry organisation token, is read from the environment. Without it, or where Sentry fails, it
// warns and the deploy goes on: a deploy never waits on Sentry. The maps are deleted either way.

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import { deleteMaps, uploadArgs, uploadsFor, type MapsEnvironment } from "../lib/sentry-maps.ts";

const { values } = parseArgs({
  options: {
    env: { type: "string" },
    release: { type: "string" },
    worker: { type: "string" },
    app: { type: "string", multiple: true },
  },
});

const environment = values.env;
const release = values.release ?? "";
if ((environment !== "staging" && environment !== "production") || release === "") {
  console.error("usage: sentry-maps.ts --env <staging|production> --release <sha> [--worker <dir>] [--app <dir>]…");
  process.exit(2);
}

const apps = values.app ?? [];
/** One upload's longest wait: a stalled one is a warning, not a deploy held until its job times out. */
const UPLOAD_TIMEOUT_MS = 120_000;
const sentryCli = createRequire(import.meta.url).resolve("@sentry/cli/bin/sentry-cli");

/** Uploads each map; a failure is a warning, as Sentry is never on a deploy's way. */
function upload(env: MapsEnvironment): void {
  if ((process.env.SENTRY_AUTH_TOKEN ?? "") === "") {
    console.log("::warning::SENTRY_AUTH_TOKEN is not set: no source maps were uploaded to Sentry");
    return;
  }
  for (const each of uploadsFor(values.worker, apps)) {
    try {
      execFileSync(process.execPath, [sentryCli, ...uploadArgs(each, env, release)], {
        stdio: "inherit",
        timeout: UPLOAD_TIMEOUT_MS,
      });
    } catch {
      console.log(`::warning::Sentry did not take the source maps in ${each.dir}`);
    }
  }
}

upload(environment);
for (const build of apps) console.log(`${build}: ${String(deleteMaps(build))} source maps deleted before it ships`);
