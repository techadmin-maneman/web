// Where a client manages a booking: the client app, on its own host (docs/decisions/0026-hosts-and-surfaces.md).
// Null where the app is not switched on yet, as in production until its release, so no page links to a host that
// does not answer.

import { ENABLED_SURFACES, SURFACE_HOSTS } from "../../../src/config/environments.ts";
import type { SiteEnvironment } from "./environment.ts";

/** Locally the browser tests serve the app here (playwright.config.ts). */
const LOCAL_APP = "http://app.localhost:4322";

export function clientAppOrigin(environment: SiteEnvironment): string | null {
  if (!ENABLED_SURFACES[environment].includes("client")) return null;
  if (environment === "local") return LOCAL_APP;
  return `https://${SURFACE_HOSTS[environment].client}`;
}
