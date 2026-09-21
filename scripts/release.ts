// Version bookkeeping for the deploy workflows, so the YAML stays declarative.
//
//   node scripts/release.ts current --worker mm-api --env production
//       prints the version serving 100% of traffic ("" when the Worker has never been deployed)
//   node scripts/release.ts upload --worker mm-api --env production --tag <sha>
//       uploads a new version without routing traffic to it; prints its ID
//   node scripts/release.ts deploy --worker mm-api --env production --split <id>@10 --split <id>@90
//       sets the traffic split (percentages must total 100)
//
// See docs/decisions/0006-deployment-pipeline.md.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";

const CONFIG = { "mm-api": "wrangler.jsonc", "mm-site": "site/wrangler.jsonc" } as const;
type Worker = keyof typeof CONFIG;
const isWorker = (value: unknown): value is Worker => typeof value === "string" && value in CONFIG;

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

function usage(): never {
  console.error("usage: release.ts <current|upload|deploy> --worker <mm-api|mm-site> --env <staging|production> …");
  process.exit(2);
}

const command = positionals[0] ?? usage();
const worker: Worker = isWorker(values.worker) ? values.worker : usage();
const environment = values.env === "staging" || values.env === "production" ? values.env : usage();

function wrangler(args: readonly string[], extraEnv: Record<string, string> = {}): string {
  return execFileSync(
    process.execPath,
    ["node_modules/wrangler/bin/wrangler.js", ...args, "--config", CONFIG[worker], "--env", environment],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, ...extraEnv } },
  );
}

const Deployment = z.object({ versions: z.array(z.object({ version_id: z.string(), percentage: z.number() })) });
const UploadEntry = z.object({ type: z.literal("version-upload"), version_id: z.string() });

switch (command) {
  case "current": {
    let raw: string;
    try {
      raw = wrangler(["deployments", "status", "--json"]);
    } catch {
      console.log(""); // never deployed: nothing to roll back to
      break;
    }
    const deployment = Deployment.parse(JSON.parse(raw));
    const full = deployment.versions.find((v) => v.percentage === 100);
    if (full === undefined) {
      console.error(
        `${worker} ${environment} is mid-rollout (${deployment.versions.map((v) => `${v.version_id}@${String(v.percentage)}%`).join(", ")}); ` +
          "finish or roll back that rollout before starting another",
      );
      process.exit(1);
    }
    console.log(full.version_id);
    break;
  }
  case "upload": {
    if (values.tag === undefined) throw new Error("--tag is required");
    const output = join(mkdtempSync(join(tmpdir(), "wrangler-")), "output.ndjson");
    wrangler(["versions", "upload", "--tag", values.tag, "--message", values.message ?? `release ${values.tag}`], {
      WRANGLER_OUTPUT_FILE_PATH: output,
    });
    const entry = readFileSync(output, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => UploadEntry.safeParse(JSON.parse(line)))
      .find((parsed) => parsed.success);
    if (entry?.success !== true) throw new Error("wrangler did not report an uploaded version");
    console.log(entry.data.version_id);
    break;
  }
  case "deploy": {
    const splits = values.split ?? [];
    const total = splits.reduce((sum, split) => sum + Number(split.split("@")[1]), 0);
    if (splits.length === 0 || total !== 100 || splits.some((s) => !/^[0-9a-f-]{36}@\d{1,3}$/.test(s))) {
      throw new Error(`--split must be <version-id>@<percent> and total 100; got ${splits.join(" ")}`);
    }
    wrangler(["versions", "deploy", ...splits, "--yes", "--message", values.message ?? `split ${splits.join(" ")}`]);
    console.error(`${worker} ${environment}: ${splits.join(", ")}`);
    break;
  }
  default:
    console.error(`unknown command ${command}`);
    usage();
}
