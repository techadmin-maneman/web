// The deployed content security policy check (scripts/release/smoke-csp.ts): which pages it opens, and that the Access
// token goes to our own hosts only, never to Turnstile, Razorpay or Cloudflare's beacon.

import { describe, expect, it } from "vitest";
import { isOwnHost, pagesToCheck, withoutEdgeScripts } from "../../../scripts/lib/smoke-csp.ts";

describe("the pages it opens", () => {
  it("opens the site's pages and each app's first screen on staging", () => {
    expect(pagesToCheck("staging")).toEqual([
      "https://staging.maneman.in/",
      "https://staging.maneman.in/book",
      "https://staging.maneman.in/try",
      "https://app-staging.maneman.in/",
      "https://ops-staging.maneman.in/",
      "https://tech-staging.maneman.in/",
    ]);
  });

  it("opens only the surfaces production has switched on", () => {
    expect(pagesToCheck("production")).toEqual([
      "https://maneman.in/",
      "https://maneman.in/book",
      "https://maneman.in/try",
    ]);
  });
});

describe("where the Access token goes", () => {
  it("goes to the environment's own hosts", () => {
    expect(isOwnHost("https://app-staging.maneman.in/api/me", "staging")).toBe(true);
    expect(isOwnHost("https://staging.maneman.in/_astro/page.js", "staging")).toBe(true);
  });

  it("goes nowhere else, not even to the other environment", () => {
    expect(isOwnHost("https://challenges.cloudflare.com/turnstile/v0/api.js", "staging")).toBe(false);
    expect(isOwnHost("https://static.cloudflareinsights.com/beacon.min.js", "staging")).toBe(false);
    expect(isOwnHost("https://checkout.razorpay.com/v1/checkout.js", "staging")).toBe(false);
    expect(isOwnHost("https://maneman.in/", "staging")).toBe(false);
    expect(isOwnHost("https://staging.maneman.in.example.com/", "staging")).toBe(false);
  });
});

// The free plan can neither switch Cloudflare's edge scripts off nor keep the beacon to the site (runbook, section 14).
describe("Cloudflare's own edge scripts", () => {
  const beacon = "script-src-elem https://static.cloudflareinsights.com/beacon.min.js/v31edd6df";

  it("are set aside: the beacon, and one inline refusal for each challenge script in the page", () => {
    expect(withoutEdgeScripts(["script-src-elem inline", beacon], 1)).toEqual([]);
  });

  it("leave every other refusal standing, an inline script of ours among them", () => {
    expect(withoutEdgeScripts(["script-src-elem inline", "script-src-elem inline"], 1)).toEqual([
      "script-src-elem inline",
    ]);
    expect(withoutEdgeScripts(["script-src-elem inline", "img-src https://evil.test/x.png"], 0)).toEqual([
      "script-src-elem inline",
      "img-src https://evil.test/x.png",
    ]);
  });
});
