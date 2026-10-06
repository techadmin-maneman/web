// Which pages the deployed content security policy check opens (scripts/release/smoke-csp.ts), and which hosts it sends the
// Access token to. Cloudflare adds scripts to pages at its edge, such as its bot checks and Web Analytics' beacon,
// which no local run can see; only a page loaded from the deployed host shows whether its policy refuses one.

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

/** Every page the check opens in an environment, on each surface switched on there. */
export function pagesToCheck(environment: RemoteEnvironmentName): string[] {
  const hosts = SURFACE_HOSTS[environment];
  return ENABLED_SURFACES[environment].flatMap((surface) =>
    PATHS[surface].map((path) => `https://${hosts[surface]}${path}`),
  );
}

/** Whether a request goes to one of the environment's own hosts: the Access token goes to no other. */
export function isOwnHost(url: string, environment: RemoteEnvironmentName): boolean {
  const ownHosts: readonly string[] = Object.values(SURFACE_HOSTS[environment]);
  return ownHosts.includes(new URL(url).hostname);
}

/** Where Cloudflare's JavaScript detections load from, in the inline script it adds to every page at its edge. */
export const CHALLENGE_SCRIPT = "/cdn-cgi/challenge-platform/";

/** Web Analytics' beacon, which Cloudflare adds to every host of the zone, and only the site's policy lets in. */
const BEACON = "https://static.cloudflareinsights.com/";

/**
 * The refusals left once Cloudflare's own two edge scripts are set aside. Neither can be switched off, nor kept to
 * one host, on the zone's free plan, so every policy refuses them and nothing of theirs runs (provisioning, step 14):
 * the beacon wherever it is refused, and one inline refusal for each challenge script Cloudflare put in the page.
 * Any other refusal stands.
 */
export function withoutEdgeScripts(refused: readonly string[], challengeScripts: number): string[] {
  let inlineLeft = challengeScripts;
  return refused.filter((refusal) => {
    const [, blocked = ""] = refusal.split(" ");
    if (blocked.startsWith(BEACON)) return false;
    if (blocked === "inline" && inlineLeft > 0) {
      inlineLeft -= 1;
      return false;
    }
    return true;
  });
}
