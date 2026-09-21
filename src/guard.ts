// The Worker refuses to run when it cannot prove which environment it is.
//
// validateStaticConfig runs at module load (src/index.ts), so a misconfigured
// Worker fails Cloudflare's startup validation and the upload itself is
// rejected. verifyDatabaseIdentity needs I/O, so it runs on the first
// invocation in each isolate and blocks every request until it passes.
// See docs/decisions/0003-environment-identity-guard.md.

import {
  EXPECTED_DATABASE_NAME,
  PROVIDER_VARS,
  isEnvironmentName,
  type EnvironmentName,
  type ProviderVar,
} from "./config/environments.ts";

export type StaticConfig = Readonly<{
  environment: EnvironmentName;
  providers: Readonly<Record<ProviderVar, string>>;
}>;

export class ConfigError extends Error {
  override readonly name = "ConfigError";
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`mm-api refuses to start: ${problems.join("; ")}`);
    this.problems = problems;
  }
}

const PROVIDER_ENTRIES = Object.entries(PROVIDER_VARS) as [ProviderVar, readonly string[]][];

/** Throws ConfigError listing every problem; returns the parsed config otherwise. */
export function validateStaticConfig(env: Readonly<Record<string, unknown>>): StaticConfig {
  const problems: string[] = [];

  const environment = env.ENVIRONMENT;
  if (environment === undefined || environment === "") {
    problems.push("ENVIRONMENT is not set");
  } else if (!isEnvironmentName(environment)) {
    problems.push(`ENVIRONMENT has unknown value ${JSON.stringify(environment)}`);
  }

  const providers: Partial<Record<ProviderVar, string>> = {};
  for (const [variable, allowed] of PROVIDER_ENTRIES) {
    const value = env[variable];
    if (typeof value !== "string" || !allowed.includes(value)) {
      problems.push(`${variable} must be one of ${allowed.join(", ")}`);
      continue;
    }
    providers[variable] = value;
    if (environment === "production" && value === "stub") {
      problems.push(`${variable} is a stub in production`);
    }
  }

  if (problems.length > 0 || !isEnvironmentName(environment)) throw new ConfigError(problems);
  return { environment, providers: providers as Record<ProviderVar, string> };
}

export type DatabaseIdentity =
  | { readonly state: "ok"; readonly databaseName: string }
  | { readonly state: "unmarked" }
  | { readonly state: "mismatch"; readonly databaseName: string; readonly expected: string }
  | { readonly state: "unreachable"; readonly error: unknown };

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
  if (row.database_name !== expected) {
    return { state: "mismatch", databaseName: row.database_name, expected };
  }
  return { state: "ok", databaseName: row.database_name };
}

/**
 * Caches a successful identity check for the life of the isolate. Failures are
 * not cached: the next invocation checks again, so marking the database or
 * fixing the binding takes effect without a redeploy.
 */
export function createIdentityGate(): (db: D1Database, environment: EnvironmentName) => Promise<DatabaseIdentity> {
  let verified: DatabaseIdentity | undefined;
  return async (db, environment) => {
    if (verified !== undefined) return verified;
    const result = await verifyDatabaseIdentity(db, environment);
    if (result.state === "ok") verified = result;
    return result;
  };
}
