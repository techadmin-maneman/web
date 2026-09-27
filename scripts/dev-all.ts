// The whole local stack in one command (docs/getting-started.md):
//
//   npm run dev:all
//
// mm-api under wrangler dev, with the local login code, the limits raised, the
// dev routes on and its cron run by hand (npm run tick); the built public site,
// as its Worker's assets serve it, with /api/* passed to mm-api; and the client
// app, the ops console and the technician app under Vite, each on its own
// *.localhost host, so mm-api answers each as its own surface
// (docs/decisions/0026-hosts-and-surfaces.md). Ctrl+C stops them all. The ports
// are scripts/lib/local-stack.ts's, and each can be moved by its variable.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { API_ORIGIN, apiDevArgs, LOCAL_LOGIN_CODE, PORTS } from "./lib/local-stack.ts";

/** Runs a step to its end before anything starts, and stops here if it fails. */
function prepare(label: string, args: readonly string[]): void {
  console.log(`\n${label}`);
  const step = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (step.status !== 0) process.exit(step.status ?? 1);
}

const children: ChildProcess[] = [];

/** Starts a server, each line of its output prefixed with its name. */
function start(name: string, args: readonly string[], env: Readonly<Record<string, string>> = {}): void {
  const child = spawn(process.execPath, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on("line", (line) => {
      console.log(`[${name}] ${line}`);
    });
  }
  child.on("exit", (code) => {
    console.log(`[${name}] stopped (${String(code)})`);
  });
  children.push(child);
}

/** Stops a server and whatever it started: on Windows a child's own children outlive it unless the tree is ended. */
function stop(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill("SIGTERM");
}

function stopAll(): never {
  for (const child of children) stop(child);
  process.exit(0);
}

async function answers(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(2_000) })).ok;
  } catch {
    return false;
  }
}

prepare("Local secrets", ["scripts/ensure-dev-vars.ts"]);
prepare("The local database, migrated", [
  "node_modules/wrangler/bin/wrangler.js",
  "d1",
  "migrations",
  "apply",
  "DB",
  "--local",
]);
prepare("The local database, marked as local", ["scripts/mark-database.ts", "local"]);
if (!existsSync("site/dist/local/index.html")) {
  prepare("The public site, built once (npm run build:site -- --env local rebuilds it)", [
    "scripts/build-site.ts",
    "--env",
    "local",
  ]);
}

process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);

start("api", [...apiDevArgs({ DEV_ROUTES: "on" }, ["--test-scheduled"])]);
start("site", ["scripts/serve-site.ts", "--env", "local", "--port", String(PORTS.site), "--api", API_ORIGIN]);
const vite = "node_modules/vite/bin/vite.js";
for (const app of ["app", "ops", "tech"] as const) {
  start(app, [vite, "--config", `apps/${app}/vite.config.ts`, "--port", String(PORTS[app]), "--strictPort"], {
    MM_API_PORT: String(PORTS.api),
  });
}

for (let tries = 0; tries < 90 && !(await answers(`${API_ORIGIN}/api/health`)); tries += 1) {
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}

console.log(`
The local stack (Ctrl+C stops it all):
  public site      http://localhost:${String(PORTS.site)}
  client app       http://app.localhost:${String(PORTS.app)}
  ops console      http://ops.localhost:${String(PORTS.ops)}      signed in as ops@localhost
  technician app   http://tech.localhost:${String(PORTS.tech)}
  mm-api           ${API_ORIGIN}

Every login code is ${LOCAL_LOGIN_CODE}. npm run db:seed:local adds clients, visits and a technician to sign in as;
npm run tick runs the cron; npm run pay:local pays for the last booking held; docs/getting-started.md has the rest.
`);
