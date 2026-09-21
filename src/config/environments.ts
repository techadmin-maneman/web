// The environments this Worker may run as, and the resources each must be bound
// to. Shared by the Worker (startup guard) and by scripts/check-wrangler-config.ts,
// so the config check and the runtime guard cannot drift apart.

export const ENVIRONMENTS = ["local", "staging", "production"] as const;
export type EnvironmentName = (typeof ENVIRONMENTS)[number];

export const REMOTE_ENVIRONMENTS = ["staging", "production"] as const;
export type RemoteEnvironmentName = (typeof REMOTE_ENVIRONMENTS)[number];

export function isEnvironmentName(value: unknown): value is EnvironmentName {
  return typeof value === "string" && (ENVIRONMENTS as readonly string[]).includes(value);
}

/** The D1 database each environment must be bound to. */
export const EXPECTED_DATABASE_NAME: Readonly<Record<EnvironmentName, string>> = {
  local: "maneman-local",
  staging: "maneman-staging",
  production: "maneman-prod",
};

/**
 * The token every environment-owned resource name must carry, so a staging
 * config that names a production bucket or queue fails the config check.
 */
export const RESOURCE_TOKEN: Readonly<Record<EnvironmentName, string>> = {
  local: "local",
  staging: "staging",
  production: "prod",
};

/** Public hostname per remote environment. */
export const HOSTNAME: Readonly<Record<RemoteEnvironmentName, string>> = {
  staging: "staging.maneman.in",
  production: "maneman.in",
};

export const ZONE_NAME = "maneman.in";
export const ZONE_ID = "d33891be281c088bf3e0e927d7ed20f9";

/** Provider implementations selectable per environment. Production may not hold a stub. */
export const PROVIDER_VARS = {
  IMAGE_PROVIDER: ["ailabtools", "stub"],
  CRM_PROVIDER: ["zoho", "stub"],
  MESSAGING_PROVIDER: ["bsp", "stub"],
} as const;
export type ProviderVar = keyof typeof PROVIDER_VARS;
