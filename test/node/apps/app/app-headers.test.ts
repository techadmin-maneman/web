// The three apps' content security policies (packages/web-kit/headers.ts). The client app's lets Razorpay Checkout
// run whole, its risk-detection script included; no app allows an inline script.

import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, headersFile } from "@maneman/web-kit/headers";
import { CLIENT_APP_POLICY } from "../../../../apps/app/headers.ts";
import { OPS_CONSOLE_POLICY } from "../../../../apps/ops/headers.ts";
import { TECHNICIAN_APP_POLICY } from "../../../../apps/tech/headers.ts";

/** One directive's sources, e.g. "script-src" → ["'self'", "https://…"]. */
function sourcesOf(policy: string, directive: string): string[] {
  const found = policy.split("; ").find((part) => part.startsWith(`${directive} `));
  return found === undefined ? [] : found.split(" ").slice(1);
}

const POLICIES = [
  ["the client app", contentSecurityPolicy(CLIENT_APP_POLICY)],
  ["the ops console", contentSecurityPolicy(OPS_CONSOLE_POLICY)],
  ["the technician app", contentSecurityPolicy(TECHNICIAN_APP_POLICY)],
] as const;

describe("the client app’s policy", () => {
  const policy = contentSecurityPolicy(CLIENT_APP_POLICY);

  // What it refuses, a Checkout frame or script from a new host among them, is reported
  // (docs/decisions/0277-alerts-that-come-sooner.md).
  it("reports what it refuses to the app's own CSP report route, by both ways browsers have", () => {
    expect(sourcesOf(policy, "report-uri")).toEqual(["/api/csp-reports"]);
    expect(sourcesOf(policy, "report-to")).toEqual(["csp"]);
    expect(headersFile(CLIENT_APP_POLICY)).toContain('Reporting-Endpoints: csp="/api/csp-reports"');
    expect(contentSecurityPolicy(OPS_CONSOLE_POLICY)).not.toContain("report-uri");
  });

  it("loads Checkout and the risk-detection script it pulls in, and Turnstile for the login", () => {
    expect(sourcesOf(policy, "script-src")).toEqual([
      "'self'",
      "https://checkout.razorpay.com",
      "https://cdn.razorpay.com",
      "https://challenges.cloudflare.com",
    ]);
  });

  it("frames Turnstile’s check, which asking for a login code needs", () => {
    expect(sourcesOf(policy, "frame-src")).toContain("https://challenges.cloudflare.com");
  });

  it("lets Checkout send its logs and open its payment frame", () => {
    expect(sourcesOf(policy, "connect-src")).toEqual(
      expect.arrayContaining([
        "https://api.razorpay.com",
        "https://lumberjack.razorpay.com",
        "https://lumberjack-cx.razorpay.com",
        "https://lumberjack-metrics.razorpay.com",
      ]),
    );
    expect(sourcesOf(policy, "frame-src")).toContain("https://api.razorpay.com");
  });

  it("allows the styles Checkout writes into the page", () => {
    expect(sourcesOf(policy, "style-src")).toEqual(["'self'", "'unsafe-inline'"]);
  });
});

describe.each(POLICIES)("%s’s policy", (_, policy) => {
  it("allows no inline script", () => {
    expect(sourcesOf(policy, "script-src")).not.toContain("'unsafe-inline'");
    expect(policy).not.toContain("unsafe-eval");
  });
});

it("keeps inline styles out of the apps that load nothing of Razorpay’s", () => {
  expect(sourcesOf(contentSecurityPolicy(OPS_CONSOLE_POLICY), "style-src")).toEqual(["'self'"]);
  expect(sourcesOf(contentSecurityPolicy(TECHNICIAN_APP_POLICY), "style-src")).toEqual(["'self'"]);
});
