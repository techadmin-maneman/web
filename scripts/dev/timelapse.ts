// The six-month timelapse (e2e/timelapse/): a fresh database from the baseline, the stack on ports of its own with the
// API's clock movable (DEV_ROUTES=on), then the run, which plays 180 days in about half an hour.
//
//   npm run build:site -- --env local && npm run build:app -- --env local    (and build:ops, build:tech)
//   node scripts/dev/timelapse.ts --baseline     once: migrations, the deployment mark and India Post's directory
//   node scripts/dev/timelapse.ts [-- --days 30]  a run; what it found is in test-results/timelapse/
//
// The run's database is this checkout's local one (.wrangler/state), replaced from the baseline each run.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { cpSync, createWriteStream, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { apiDevArgs } from "../lib/local-stack.ts";
import { API, BASELINE, OUT, PORTS } from "../../e2e/timelapse/stack.ts";

const STATE = ".wrangler/state";

function must(args: readonly string[]): void {
  const step = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (step.status !== 0) process.exit(step.status ?? 1);
}

if (process.argv.includes("--baseline")) {
  rmSync(STATE, { recursive: true, force: true });
  must(["node_modules/wrangler/bin/wrangler.js", "d1", "migrations", "apply", "DB", "--local"]);
  must(["scripts/release/mark-database.ts", "local"]);
  must(["scripts/ops/load-pincode-directory.ts", "local"]);
  rmSync(BASELINE, { recursive: true, force: true });
  cpSync(STATE, BASELINE, { recursive: true });
  console.log(`baseline kept in ${BASELINE}`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error("no baseline: node scripts/dev/timelapse.ts --baseline");
  process.exit(1);
}
rmSync(STATE, { recursive: true, force: true });
cpSync(BASELINE, STATE, { recursive: true });
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const env = {
  ...process.env,
  MM_API_PORT: String(PORTS.api),
  MM_INSPECTOR_PORT: String(PORTS.inspector),
  MM_SITE_PORT: String(PORTS.site),
  MM_APP_PORT: String(PORTS.app),
  MM_OPS_PORT: String(PORTS.ops),
  MM_TECH_PORT: String(PORTS.tech),
};
const servers: ChildProcess[] = [];

function start(name: string, args: readonly string[]): void {
  const child = spawn(process.execPath, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  const log = createWriteStream(join(OUT, `${name}.log`));
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  servers.push(child);
}

function stopAll(): void {
  for (const child of servers) {
    if (child.pid === undefined) continue;
    // wrangler's runtime is a grandchild: only the whole tree goes.
    if (process.platform === "win32")
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill();
  }
}
process.on("exit", stopAll);

// The local stack's own arguments, on the timelapse's ports.
const apiArgs = apiDevArgs({ DEV_ROUTES: "on" }, ["--test-scheduled"]);
apiArgs[apiArgs.indexOf("--port") + 1] = String(PORTS.api);
apiArgs[apiArgs.indexOf("--inspector-port") + 1] = String(PORTS.inspector);
start("api", apiArgs);
for (const [name, script, port] of [
  ["site", "scripts/dev/serve-site.ts", PORTS.site],
  ["app", "scripts/dev/serve-app.ts", PORTS.app],
  ["ops", "scripts/dev/serve-ops.ts", PORTS.ops],
  ["tech", "scripts/dev/serve-tech.ts", PORTS.tech],
] as const) {
  start(name, [script, "--env", "local", "--port", String(port), "--api", API]);
}

const deadline = Date.now() + 180_000;
for (;;) {
  const healthy = await fetch(`${API}/api/health`).then(
    (answer) => answer.ok,
    () => false,
  );
  if (healthy) break;
  if (Date.now() > deadline) {
    console.error(`the API never answered: see ${OUT}/api.log`);
    process.exit(1);
  }
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}

const extra = process.argv.slice(2).filter((arg) => arg !== "--");
// Not spawnSync: this process must keep reading the servers' output, or a full pipe stalls the API mid-request.
const run = spawn(
  process.execPath,
  ["node_modules/@playwright/test/cli.js", "test", "--config", "playwright.timelapse.config.ts", ...extra],
  { stdio: "inherit", env: { ...env, TIMELAPSE: "1" } },
);
const status = await new Promise<number>((resolve) => {
  run.on("exit", (code) => {
    resolve(code ?? 1);
  });
});
stopAll();
process.exit(status);
