// Which pages the deployed content security policy check opens (scripts/release/smoke-csp.ts), and which hosts it sends the
// Access token to. Cloudflare adds scripts to pages at its edge, such as its bot checks and Web Analytics' beacon,
// which no local run can see; only a page loaded from the deployed host shows whether its policy refuses one.

import { PRODUCTION_LIVE } from "../../site/src/lib/flags.ts";
import {
  ENABLED_SURFACES,
  SURFACE_HOSTS,
  type RemoteEnvironmentName,
  type Surface,
} from "../../src/config/environments.ts";

/** The site's own kinds of page, and each app's first screen. */
const PATHS: Readonly<Record<Surface, readonly string[]>> = {
  public: ["/", "/book", "/try"],
  client: ["/"],
  ops: ["/"],
  tech: ["/"],
};

/**
 * Every page the check opens in an environment, on each surface switched on there. Production's site is its
 * coming-soon page alone until it goes live (site/src/lib/flags.ts).
 */
export function pagesToCheck(environment: RemoteEnvironmentName, siteLive = PRODUCTION_LIVE): string[] {
  const hosts = SURFACE_HOSTS[environment];
  const pathsOf = (surface: Surface) =>
    surface === "public" && environment === "production" && !siteLive ? ["/"] : PATHS[surface];
  return ENABLED_SURFACES[environment].flatMap((surface) =>
    pathsOf(surface).map((path) => `https://${hosts[surface]}${path}`),
  );
}

/** Whether a request goes to one of the environment's own hosts: the Access token goes to no other. */
export function isOwnHost(url: string, environment: RemoteEnvironmentName): boolean {
  const ownHosts: readonly string[] = Object.values(SURFACE_HOSTS[environment]);
  return ownHosts.includes(new URL(url).hostname);
}
