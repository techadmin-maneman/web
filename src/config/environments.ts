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

/**
 * Whether a price ops set is written to FSM's catalogue (docs/decisions/0073-prices-from-the-price-book.md).
 * Off until the owner switches it on in production, and never on in staging, whose FSM is the owner's real org
 * and whose price book holds placeholders. A constant here rather than a Worker var: mm-api is at the Workers
 * Free limit of 64 variables and secrets (docs/decisions/0009-stay-inside-cloudflare-free-tier.md).
 */
export const FSM_CATALOGUE_PUSH: Readonly<Record<EnvironmentName, boolean>> = {
  local: false,
  staging: false,
  production: false,
};

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

/**
 * The sites mm-api answers on (docs/decisions/0026-hosts-and-surfaces.md):
 * the public site, and Phase 2's client app, ops console and technician app.
 * Each is its own app with its own routes, chosen by the request's host.
 */
export const SURFACES = ["public", "client", "ops", "tech"] as const;
export type Surface = (typeof SURFACES)[number];

/** Each surface's hostname per remote environment. Staging's are one level deep, for the free certificate. */
export const SURFACE_HOSTS: Readonly<Record<RemoteEnvironmentName, Readonly<Record<Surface, string>>>> = {
  staging: {
    public: "staging.maneman.in",
    client: "app-staging.maneman.in",
    ops: "ops-staging.maneman.in",
    tech: "tech-staging.maneman.in",
  },
  production: {
    public: "maneman.in",
    client: "app.maneman.in",
    ops: "ops.maneman.in",
    tech: "tech.maneman.in",
  },
};

/**
 * The surfaces switched on in each environment. A remote surface is switched
 * on once its DNS record and its Cloudflare Access application exist; then it
 * gets its route (the config check requires one per switched-on surface).
 * Locally every surface answers, on localhost and on app., ops. and tech.localhost.
 */
export const ENABLED_SURFACES: Readonly<Record<EnvironmentName, readonly Surface[]>> = {
  local: SURFACES,
  // Switched on 22 September 2026, once each host had its DNS record and Access application.
  staging: SURFACES,
  production: ["public"],
};

/** The public site's hostname per remote environment. */
export const HOSTNAME: Readonly<Record<RemoteEnvironmentName, string>> = {
  staging: SURFACE_HOSTS.staging.public,
  production: SURFACE_HOSTS.production.public,
};

/** Where the ops console answers, for the links in alerts. Locally, where the browser tests serve it. */
export const OPS_ORIGIN: Readonly<Record<EnvironmentName, string>> = {
  local: "http://ops.localhost:4323",
  staging: `https://${SURFACE_HOSTS.staging.ops}`,
  production: `https://${SURFACE_HOSTS.production.ops}`,
};

/**
 * Where links in messages point, e.g. a WhatsApp copy's result link or an invite. Locally the site is on :4321
 * (npm run dev:all, and the browser tests), which serves /r/:code and passes /api/* to mm-api; mm-api's own :8787
 * has no pages.
 */
export const PUBLIC_ORIGIN: Readonly<Record<EnvironmentName, string>> = {
  local: "http://localhost:4321",
  staging: "https://staging.maneman.in",
  production: "https://maneman.in",
};

export const ZONE_NAME = "maneman.in";
export const ZONE_ID = "d33891be281c088bf3e0e927d7ed20f9";

/** Provider implementations selectable per environment. Production may not hold a stub. */
export const PROVIDER_VARS = {
  IMAGE_PROVIDER: ["ailabtools", "stub"],
  CRM_PROVIDER: ["zoho", "stub"],
  // Evolution for now; an official BSP later (docs/decisions/0016-whatsapp-through-evolution.md).
  MESSAGING_PROVIDER: ["evolution", "stub"],
  // Verifies the Cloudflare Access token on the ops surface (docs/decisions/0031-access-and-audit.md).
  ACCESS_PROVIDER: ["cloudflare", "stub"],
  // Login codes by SMS need a DLT-registered provider. Until one is chosen, "none": the app offers WhatsApp only
  // (docs/decisions/0030-one-time-codes.md). "none" is not a stub, so production may hold it.
  SMS_PROVIDER: ["none", "stub"],
  // Zoho FSM, the system of record for field work, and Zoho Books, for invoices and receipts
  // (docs/decisions/0032-fsm-mirror.md). "none" until the client surface is switched on where it runs, as
  // production is until Phase 2's release.
  FSM_PROVIDER: ["zoho", "stub", "none"],
  BOOKS_PROVIDER: ["zoho", "stub", "none"],
  // Razorpay, for payments (docs/decisions/0044-payments-mirror.md): test keys on staging, none in production until
  // Phase 2's release.
  PAYMENTS_PROVIDER: ["razorpay", "stub", "none"],
  // Google Maps Platform, for the address search and the coordinate the geofence measures against
  // (docs/decisions/0054-address-capture.md). "none" wherever the owner's key is not yet in place: the address form
  // then takes a typed address, as it did before, and saves no coordinate.
  GEOCODE_PROVIDER: ["google", "stub", "none"],
} as const;
export type ProviderVar = keyof typeof PROVIDER_VARS;

/** Each provider var as one of the values PROVIDER_VARS allows it: what the guard hands on once it has checked them. */
export type Providers = { readonly [Variable in ProviderVar]: (typeof PROVIDER_VARS)[Variable][number] };
