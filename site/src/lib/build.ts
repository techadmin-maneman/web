// What this build is, for pages and components. MM_ENV reaches the page code
// as __MM_ENV__ (site/astro.config.ts).

import type { SiteEnvironment } from "./environment.ts";

declare const __MM_ENV__: SiteEnvironment;

export const ENVIRONMENT: SiteEnvironment = __MM_ENV__;
export const IS_PRODUCTION = ENVIRONMENT === "production";

/** The design's "Placeholder" tags (v2's showPlaceholderTags): on everywhere but production. */
export const SHOW_PLACEHOLDER_TAGS = !IS_PRODUCTION;

/** Placeholder material shows everywhere but production, where only published blocks do. */
export function isShown(block: { readonly publish: boolean }): boolean {
  return !IS_PRODUCTION || block.publish;
}
