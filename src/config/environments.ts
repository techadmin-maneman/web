// The environments this Worker may run as, and the resources each must be bound
// to. Shared by the Worker (startup guard) and by scripts/ci/check-wrangler-config.ts,
// so the config check and the runtime guard cannot drift apart.

import { isOneOf } from "../lib/one-of.ts";

export const ENVIRONMENTS = ["local", "staging", "production"] as const;
export type EnvironmentName = (typeof ENVIRONMENTS)[number];

export const REMOTE_ENVIRONMENTS = ["staging", "production"] as const;
export type RemoteEnvironmentName = (typeof REMOTE_ENVIRONMENTS)[number];

export function isEnvironmentName(value: unknown): value is EnvironmentName {
  return isOneOf(ENVIRONMENTS, value);
}

/**
 * Whether the hourly item check makes and writes Books' items, in the environment's own organisation, from the
 * console's services and the price book (src/domain/books/books-items.ts). Staging and production never share an
 * organisation (docs/decisions/0200-staging-tenants-of-its-own.md): production writes once its price book holds the
 * owner's prices. A constant, kept with the code that reads it (docs/decisions/0194-the-build-on-workers-paid.md).
 */
export const BOOKS_ITEM_PUSH: Readonly<Record<EnvironmentName, boolean>> = {
  local: false,
  staging: true,
  production: false,
};

/**
 * The Books accounts a receipt's bill posts to (src/domain/books/books-bills.ts): a hair system's lines to Cost of Goods
 * Sold, a consumable's to Raw Materials and Consumables, in each environment's own organisation. Production's are the
 * real organisation's; staging's are those of its own once it has one (docs/provisioning.md, step 11b). A constant
 * rather than Worker vars, for the same limit as BOOKS_ITEM_PUSH's. None locally, where no bill is made.
 */
export const BOOKS_BILL_ACCOUNTS: Readonly<
  Record<EnvironmentName, { readonly hairSystems: string; readonly consumables: string } | null>
> = {
  local: null,
  staging: { hairSystems: "4242595000000000567", consumables: "4242595000000034057" },
  production: { hairSystems: "4242595000000000567", consumables: "4242595000000034057" },
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
 * the public site, the client app, the ops console and the technician app.
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
 * The pages a Turnstile token may come from, as siteverify names them (docs/turnstile.md): a token solved on any other
 * page is refused, though Cloudflare passed it. Locally the test keys answer for any page, so none is checked.
 */
export const TURNSTILE_HOSTS: Readonly<Record<RemoteEnvironmentName, readonly string[]>> = {
  staging: [SURFACE_HOSTS.staging.public, SURFACE_HOSTS.staging.client],
  production: [
    SURFACE_HOSTS.production.public,
    `www.${SURFACE_HOSTS.production.public}`,
    SURFACE_HOSTS.production.client,
  ],
};

/**
 * The surfaces switched on in each environment. A remote surface is switched
 * on once its DNS record and its Cloudflare Access application exist; then it
 * gets its route (the config check requires one per switched-on surface).
 * Locally every surface answers, on localhost and on app., ops. and tech.localhost.
 */
export const ENABLED_SURFACES: Readonly<Record<EnvironmentName, readonly Surface[]>> = {
  local: SURFACES,
  // Each host needs its DNS record and Access application first.
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

/** Where the client app answers, for the messages that send a client to it. Locally, where the browser tests serve it. */
export const CLIENT_ORIGIN: Readonly<Record<EnvironmentName, string>> = {
  local: "http://app.localhost:4322",
  staging: `https://${SURFACE_HOSTS.staging.client}`,
  production: `https://${SURFACE_HOSTS.production.client}`,
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
  // Evolution's bridge, or the WhatsApp Business Platform through MSG91 once the business number's templates are
  // approved (docs/decisions/0114-whatsapp-business-platform-through-msg91.md).
  MESSAGING_PROVIDER: ["evolution", "msg91", "stub"],
  // Verifies the Cloudflare Access token on the ops surface (docs/decisions/0031-access-and-audit.md).
  ACCESS_PROVIDER: ["cloudflare", "stub"],
  // Login codes by SMS need a template DLT has approved. Until it is, "none": the app offers WhatsApp only, and a
  // code WhatsApp fails to send goes nowhere else (docs/decisions/0030-one-time-codes.md). "none" is not a stub, so
  // production may hold it.
  SMS_PROVIDER: ["none", "stub", "msg91"],
  // Zoho Books, for customers, invoices and receipts. "none" until the client surface is switched on where it runs.
  BOOKS_PROVIDER: ["zoho", "stub", "none"],
  // Razorpay, for payments (docs/decisions/0044-payments-mirror.md): test keys on staging, none in production until
  // the client surface is switched on there.
  PAYMENTS_PROVIDER: ["razorpay", "stub", "none"],
  // Google Maps Platform, for the address search and the coordinate the geofence measures against
  // (docs/decisions/0054-address-capture.md). "none" wherever a Google key is not yet in place: the address form
  // then takes a typed address, as it did before, and saves no coordinate.
  GEOCODE_PROVIDER: ["google", "stub", "none"],
  // Google's Routes and Maps Static APIs, for the dispatch board's drive times and day map (ADR 0120). "none" until the
  // owner switches them on for the key (docs/provisioning.md, step 13): the board then shows neither.
  ROUTES_PROVIDER: ["google", "stub", "none"],
  // The nightly copy for reporting (docs/decisions/0146-the-nightly-analytics-copy.md): Supabase through Hyperdrive,
  // whose binding is declared where it is switched on. "none" until then, and in production until counsel has ruled on
  // the copy's pseudonymous rows.
  ANALYTICS_PROVIDER: ["supabase", "stub", "none"],
} as const;
export type ProviderVar = keyof typeof PROVIDER_VARS;

/** Each provider var as one of the values PROVIDER_VARS allows it: what the guard hands on once it has checked them. */
export type Providers = { readonly [Variable in ProviderVar]: (typeof PROVIDER_VARS)[Variable][number] };
