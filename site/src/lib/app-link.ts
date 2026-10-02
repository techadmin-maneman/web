// Where a client manages a booking: the client app, on its own host (docs/decisions/0026-hosts-and-surfaces.md).
// Null where the app is not switched on yet, as in production until its release, so no page links to a host that
// does not answer.

import { mobileDigits } from "@maneman/web-kit/mobile";
import { ENABLED_SURFACES, SURFACE_HOSTS } from "../../../src/config/environments.ts";
import type { SiteEnvironment } from "./environment.ts";

/** Locally the browser tests serve the app here (playwright.config.ts). */
const LOCAL_APP = "http://app.localhost:4322";

function clientAppOrigin(environment: SiteEnvironment): string | null {
  if (!ENABLED_SURFACES[environment].includes("client")) return null;
  if (environment === "local") return LOCAL_APP;
  return `https://${SURFACE_HOSTS[environment].client}`;
}

/**
 * The app's sign-in with the number typed already filled in; the code is still asked for. The number goes after
 * the #, which the browser never sends to a server.
 */
export function signInLink(environment: SiteEnvironment, typedMobile: string): string | null {
  const origin = clientAppOrigin(environment);
  if (origin === null) return null;
  const digits = mobileDigits(typedMobile);
  return digits === null ? origin : `${origin}/#mobile=${digits}`;
}
