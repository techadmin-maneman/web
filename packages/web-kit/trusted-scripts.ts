// Trusted Types, which the site's pages enforce (require-trusted-types-for 'script', site/src/lib/static-files.ts): a
// script's address set from code must come through a policy, and HTML or script text cannot be written into a page as
// a string at all. The loaders of Turnstile and the analytics tags take their address from `scriptAddress`; the
// default policy takes any other script's a tag adds of its own, from the same hosts (./script-origins.ts). Nothing on the pages writes HTML
// or script text, so neither policy makes any. Where Trusted Types is not enforced, as in the apps, the address is
// handed back as it is.

import { SCRIPT_ORIGINS } from "./script-origins.ts";

/** The little of the Trusted Types API used here, which TypeScript's DOM types do not describe. */
interface ScriptPolicy {
  createScriptURL(address: string): unknown;
}
interface TrustedTypes {
  readonly defaultPolicy: ScriptPolicy | null;
  createPolicy(name: string, rules: { createScriptURL: (address: string) => string }): ScriptPolicy;
}

function allowed(address: string): string {
  const origin = new URL(address, location.href).origin;
  if (origin === location.origin || SCRIPT_ORIGINS.includes(origin)) return address;
  throw new TypeError(`${origin} is not a host the pages load scripts from`);
}

let policy: ScriptPolicy | null = null;

/**
 * A script's address as a script's `src` takes it: a TrustedScriptURL where Trusted Types is enforced, which `src`
 * takes as it takes a string, and the address itself where it is not.
 */
export function scriptAddress(address: string): string {
  const types = (globalThis as { trustedTypes?: TrustedTypes }).trustedTypes;
  if (types === undefined) return allowed(address);
  if (policy === null) {
    policy = types.createPolicy("mm-scripts", { createScriptURL: allowed });
    if (types.defaultPolicy === null) types.createPolicy("default", { createScriptURL: allowed });
  }
  return policy.createScriptURL(address) as string;
}
