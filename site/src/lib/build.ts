// What this build is, for pages and components. MM_ENV reaches the page code
// as __MM_ENV__ (site/astro.config.ts).

import type { TryOnPromiseName } from "../content/site.ts";
import type { SiteEnvironment } from "./environment.ts";

declare const __MM_ENV__: SiteEnvironment;

export const ENVIRONMENT: SiteEnvironment = __MM_ENV__;
export const IS_PRODUCTION = ENVIRONMENT === "production";

/** The design's "Placeholder" tags (v2's showPlaceholderTags): on everywhere but production. */
export const SHOW_PLACEHOLDER_TAGS = !IS_PRODUCTION;

/**
 * The try-on's promise this build makes (docs/decisions/0084-a-clients-try-on-is-kept.md): production keeps the
 * approved notices until counsel approves the ones that keep a client's try-on, which every other build shows.
 */
export const TRY_ON_PROMISE: TryOnPromiseName = IS_PRODUCTION ? "approved" : "awaitingCounsel";

/** Placeholder material shows everywhere but production, where only published blocks do. */
export function isShown(block: { readonly publish: boolean }): boolean {
  return !IS_PRODUCTION || block.publish;
}
