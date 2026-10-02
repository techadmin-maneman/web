// The deployed content security policy check (scripts/smoke-csp.ts): which pages it opens, and that the Access
// token goes to our own hosts only, never to Turnstile, Razorpay or Cloudflare's beacon.

import { describe, expect, it } from "vitest";
import { isOwnHost, pagesToCheck } from "../../scripts/lib/smoke-csp.ts";

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
