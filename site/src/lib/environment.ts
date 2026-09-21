// Which environment this build is for. Set by MM_ENV at build time; each
// environment gets its own build (site/astro.config.ts).

export const SITE_ENVIRONMENTS = ["local", "staging", "production"] as const;
export type SiteEnvironment = (typeof SITE_ENVIRONMENTS)[number];

export function siteEnvironment(value: string | undefined): SiteEnvironment {
  const found = SITE_ENVIRONMENTS.find((environment) => environment === value);
  if (found === undefined) {
    throw new Error(`MM_ENV must be one of ${SITE_ENVIRONMENTS.join(", ")}; got ${String(value)}`);
  }
  return found;
}
