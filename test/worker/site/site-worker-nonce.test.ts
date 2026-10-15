// The site Worker's nonce (site/src/worker.ts; docs/decisions/0206-trusted-types-and-a-nonce-per-page.md): every page
// it answers has its policy's scripts given a nonce of the request's own, for a script Cloudflare adds at its edge, and
// anything but a page is passed on as the assets gave it.

import { describe, expect, it } from "vitest";
import { createSiteWorker, type SiteEnv } from "../../../site/src/worker.ts";
import { REWARD } from "./site-worker-fixtures.ts";

const POLICY = "default-src 'self'; script-src 'self' 'sha256-abc='; style-src 'self'; frame-ancestors 'none'";

function env(type = "text/html"): SiteEnv {
  const fetcher = (answer: (request: Request) => Response) =>
    ({ fetch: (input: RequestInfo | URL) => Promise.resolve(answer(new Request(input))) }) as unknown as Fetcher;
  return {
    ASSETS: fetcher(
      () => new Response("<p>A page</p>", { headers: { "Content-Type": type, "Content-Security-Policy": POLICY } }),
    ),
    API: fetcher((request) =>
      new URL(request.url).pathname === "/api/referral-reward"
        ? Response.json(REWARD)
        : Response.json({ cities: [], areas: {} }),
    ),
  };
}

async function policyAt(path: string, type?: string): Promise<string> {
  const response = await createSiteWorker().fetch(new Request(`https://maneman.in${path}`), env(type));
  return response.headers.get("Content-Security-Policy") ?? "";
}

const nonceIn = (policy: string) => /script-src 'nonce-([A-Za-z0-9+/]{22}==)' 'self'/.exec(policy)?.[1];

describe("the site Worker's nonce", () => {
  it.each(["/privacy", "/book", "/", "/areas/delhi"])(
    "gives %s's scripts a nonce, and leaves the rest of its policy",
    async (path) => {
      const policy = await policyAt(path);
      expect(nonceIn(policy)).toBeDefined();
      expect(policy.replace(/'nonce-[^']+' /, "")).toBe(POLICY);
    },
  );

  it("gives each request a nonce of its own", async () => {
    const nonces = await Promise.all([1, 2, 3].map(() => policyAt("/terms").then(nonceIn)));
    expect(new Set(nonces).size).toBe(3);
  });

  it("passes anything but a page on as the assets gave it", async () => {
    expect(await policyAt("/terms", "image/png")).toBe(POLICY);
  });
});
