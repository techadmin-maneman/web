// A script's address under Trusted Types (packages/web-kit/trusted-scripts.ts): through a policy of the site's own, made
// once with a default policy beside it, and only for the site's origin and the hosts the pages load scripts from.

import { afterEach, describe, expect, it, vi } from "vitest";

const TURNSTILE = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** A browser's Trusted Types, as far as the module uses it: each policy made, by name, with its rule for addresses. */
function fakeTrustedTypes() {
  const made = new Map<string, (address: string) => string>();
  const types = {
    defaultPolicy: null as { createScriptURL: (address: string) => unknown } | null,
    createPolicy(name: string, rules: { createScriptURL: (address: string) => string }) {
      made.set(name, rules.createScriptURL);
      const policy = { createScriptURL: (address: string) => ({ trusted: rules.createScriptURL(address) }) };
      if (name === "default") types.defaultPolicy = policy;
      return policy;
    },
  };
  vi.stubGlobal("trustedTypes", types);
  return made;
}

async function freshModule() {
  vi.resetModules();
  return import("../../packages/web-kit/trusted-scripts.ts");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a script's address", () => {
  it("comes through the site's own policy, made once with a default policy beside it", async () => {
    const made = fakeTrustedTypes();
    const { scriptAddress } = await freshModule();
    expect(scriptAddress(TURNSTILE)).toEqual({ trusted: TURNSTILE });
    scriptAddress("https://www.googletagmanager.com/gtag/js?id=G-TEST");
    expect([...made.keys()]).toEqual(["mm-scripts", "default"]);
  });

  it("is refused from a host the pages load no script from, by either policy", async () => {
    const made = fakeTrustedTypes();
    const { scriptAddress } = await freshModule();
    expect(() => scriptAddress("https://scripts.example.com/a.js")).toThrow("not a host the pages load scripts from");
    expect(() => made.get("default")?.("https://scripts.example.com/b.js")).toThrow();
    expect(made.get("default")?.(`${location.origin}/_astro/a.js`)).toBe(`${location.origin}/_astro/a.js`);
  });

  it("is the address itself where Trusted Types is not enforced", async () => {
    const { scriptAddress } = await freshModule();
    expect(scriptAddress(TURNSTILE)).toBe(TURNSTILE);
  });
});
