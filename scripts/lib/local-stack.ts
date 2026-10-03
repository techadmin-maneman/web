// The local stack: the port each server takes, and what mm-api runs with there.
// npm run dev:all (scripts/dev-all.ts) and the browser tests
// (playwright.config.ts) both read them from here, so the two cannot drift. A
// port another program already holds can be moved with its variable, e.g.
// MM_API_PORT=8797 npm run dev:all (docs/getting-started.md).

export type Server = "api" | "inspector" | "site" | "app" | "ops" | "tech";

/** Each server's port unless its variable says otherwise. The apps are the ones src/config/environments.ts links to. */
const DEFAULT_PORTS: Readonly<Record<Server, number>> = {
  api: 8787,
  inspector: 9230,
  site: 4321,
  app: 4322,
  ops: 4323,
  tech: 4324,
};

const PORT_VARIABLES: Readonly<Record<Server, string>> = {
  api: "MM_API_PORT",
  inspector: "MM_INSPECTOR_PORT",
  site: "MM_SITE_PORT",
  app: "MM_APP_PORT",
  ops: "MM_OPS_PORT",
  tech: "MM_TECH_PORT",
};

/** The port `server` takes: its variable's value when set, else the default. */
export function portOf(server: Server, env: Readonly<Record<string, string | undefined>> = process.env): number {
  const set = env[PORT_VARIABLES[server]];
  if (set === undefined || set === "") return DEFAULT_PORTS[server];
  const port = Number(set);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${PORT_VARIABLES[server]} must be a port number, not "${set}"`);
  }
  return port;
}

export const PORTS: Readonly<Record<Server, number>> = {
  api: portOf("api"),
  inspector: portOf("inspector"),
  site: portOf("site"),
  app: portOf("app"),
  ops: portOf("ops"),
  tech: portOf("tech"),
};

export const API_ORIGIN = `http://127.0.0.1:${String(PORTS.api)}`;

/** Every login code locally, client and technician alike (docs/decisions/0030-one-time-codes.md). */
export const LOCAL_LOGIN_CODE = "246810";

/**
 * What mm-api runs with locally, beyond wrangler.jsonc. Tests book leads, render try-ons and ask for codes from
 * one address, run after run on one database, so the limits per address and the daily ceilings are raised.
 */
export const LOCAL_VARS: Readonly<Record<string, string>> = {
  LEAD_IP_DAILY_LIMIT: "10000",
  TRYON_UPLOAD_IP_HOURLY_LIMIT: "10000",
  TRYON_GENERATE_IP_HOURLY_LIMIT: "10000",
  UPLOAD_DAILY_CEILING: "10000",
  RENDER_DAILY_CEILING: "10000",
  RESULT_READ_DAILY_CEILING: "10000",
  OTP_FIXED_CODE: LOCAL_LOGIN_CODE,
  OTP_IP_HOURLY_LIMIT: "10000",
  // The read surfaces' tests share one fitted client (e2e/global-setup.ts), each logging in.
  OTP_MOBILE_DAILY_LIMIT: "10000",
  OTP_DAILY_CEILING: "10000",
  OTP_TECH_DAILY_CEILING: "10000",
  // Each saved address takes from the address-lookup ceiling too. Its own cap is GEOCODE_CEILING_MAX, so no further.
  GEOCODE_DAILY_CEILING: "1800",
};

/** The arguments that start mm-api under wrangler dev with the local vars, and any others given. */
export function apiDevArgs(extra: Readonly<Record<string, string>> = {}, flags: readonly string[] = []): string[] {
  const vars = Object.entries({ ...LOCAL_VARS, ...extra }).flatMap(([name, value]) => ["--var", `${name}:${value}`]);
  return [
    "node_modules/wrangler/bin/wrangler.js",
    "dev",
    "--port",
    String(PORTS.api),
    "--inspector-port",
    String(PORTS.inspector),
    ...flags,
    ...vars,
  ];
}
