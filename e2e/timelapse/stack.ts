// Where the timelapse's stack runs: ports of its own, so it never meets another local run's servers, and a database
// of its own (scripts/dev/timelapse.ts starts them).

import { portOf } from "../../scripts/lib/local-stack.ts";

/** The ports unless MM_*_PORT says otherwise; a hundred above the local stack's. */
const env = {
  MM_API_PORT: "8897",
  MM_INSPECTOR_PORT: "9330",
  MM_SITE_PORT: "4521",
  MM_APP_PORT: "4522",
  MM_OPS_PORT: "4523",
  MM_TECH_PORT: "4524",
  ...process.env,
};

export const PORTS = {
  api: portOf("api", env),
  inspector: portOf("inspector", env),
  site: portOf("site", env),
  app: portOf("app", env),
  ops: portOf("ops", env),
  tech: portOf("tech", env),
} as const;

export const API = `http://127.0.0.1:${String(PORTS.api)}`;
export const SITE = `http://127.0.0.1:${String(PORTS.site)}`;
export const APP = `http://app.localhost:${String(PORTS.app)}`;
export const OPS = `http://ops.localhost:${String(PORTS.ops)}`;
export const TECH = `http://tech.localhost:${String(PORTS.tech)}`;

/** Where the run's database lives, apart from the local stack's. */
export const PERSIST = ".wrangler/timelapse";
/** A migrated database with India Post's directory loaded, copied in for each run. */
export const BASELINE = ".wrangler/timelapse-baseline";
/** Where the run writes what it found. */
export const OUT = "test-results/timelapse";

export const LOGIN_CODE = "246810";
/** Cloudflare's dummy token, which the local API accepts (docs/turnstile.md). */
export const TURNSTILE = "XXXX.DUMMY.TOKEN.XXXX";
