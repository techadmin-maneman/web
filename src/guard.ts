// The Worker refuses to run when it cannot prove which environment it is.
//
// validateStaticConfig runs when the module loads (src/index.ts). If it throws,
// Cloudflare rejects the upload and `wrangler dev` does not start.
//
// verifyDatabaseIdentity needs to query D1, which a module cannot do while
// loading, so it runs on the first request instead and blocks every request
// until it passes. See docs/decisions/0003-environment-identity-guard.md.

import {
  EXPECTED_DATABASE_NAME,
  PROVIDER_VARS,
  isEnvironmentName,
  type EnvironmentName,
  type ProviderVar,
} from "./config/environments.ts";
import { readSettings, type Settings } from "./config/settings.ts";

export type StaticConfig = Readonly<{
  environment: EnvironmentName;
  providers: Readonly<Record<ProviderVar, string>>;
  settings: Settings;
}>;

export class ConfigError extends Error {
  override readonly name = "ConfigError";
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`mm-api refuses to start: ${problems.join("; ")}`);
    this.problems = problems;
  }
}

/** Returns the parsed config, or throws a ConfigError listing every problem. */
export function validateStaticConfig(env: Readonly<Record<string, unknown>>): StaticConfig {
  const problems: string[] = [];

  let environment: EnvironmentName | undefined;
  if (env.ENVIRONMENT === undefined || env.ENVIRONMENT === "") {
    problems.push("ENVIRONMENT is not set");
  } else if (isEnvironmentName(env.ENVIRONMENT)) {
    environment = env.ENVIRONMENT;
  } else {
    problems.push(`ENVIRONMENT has unknown value ${JSON.stringify(env.ENVIRONMENT)}`);
  }

  const providers: Partial<Record<ProviderVar, string>> = {};
  for (const variable of Object.keys(PROVIDER_VARS) as ProviderVar[]) {
    const allowed: readonly string[] = PROVIDER_VARS[variable];
    const value = env[variable];
    if (typeof value !== "string" || !allowed.includes(value)) {
      problems.push(`${variable} must be one of ${allowed.join(", ")}`);
      continue;
    }
    if (environment === "production" && value === "stub") {
      problems.push(`${variable} is a stub in production`);
    }
    providers[variable] = value;
  }

  const { settings, problems: settingProblems } = readSettings(env, environment, providers);
  problems.push(...settingProblems);

  if (environment === undefined || problems.length > 0) throw new ConfigError(problems);
  return { environment, providers: providers as Record<ProviderVar, string>, settings };
}

export type DatabaseIdentity =
  | { readonly state: "ok"; readonly databaseName: string }
  | { readonly state: "unmarked" }
  | { readonly state: "mismatch"; readonly databaseName: string; readonly expected: string }
  | { readonly state: "unreachable"; readonly error: unknown };

/** Reads the database's identity row and compares it with the environment's database. */
export async function verifyDatabaseIdentity(db: D1Database, environment: EnvironmentName): Promise<DatabaseIdentity> {
  const expected = EXPECTED_DATABASE_NAME[environment];

  let row: { database_name: string } | null;
  try {
    row = await db
      .prepare("SELECT database_name FROM deployment_identity WHERE id = 1")
      .first<{ database_name: string }>();
  } catch (error) {
    return { state: "unreachable", error };
  }

  if (row === null) return { state: "unmarked" };
  if (row.database_name !== expected) return { state: "mismatch", databaseName: row.database_name, expected };
  return { state: "ok", databaseName: row.database_name };
}

export type IdentityCheck = (db: D1Database, environment: EnvironmentName) => Promise<DatabaseIdentity>;

/**
 * verifyDatabaseIdentity, remembering a success for the life of the isolate.
 * A failure is not remembered: the next request checks again, so marking the
 * database takes effect without a redeploy.
 */
export function createCachedIdentityCheck(): IdentityCheck {
  let success: DatabaseIdentity | undefined;
  return async (db, environment) => {
    if (success !== undefined) return success;
    const result = await verifyDatabaseIdentity(db, environment);
    if (result.state === "ok") success = result;
    return result;
  };
}
