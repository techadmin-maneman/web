// Every route the client and technician surfaces serve refuses a caller with no session, but for the few that sign
// one in or need none; and every route of the console refuses a caller Access has not let in. Each route declares its
// guard (src/http/session-routes.ts), so a route added without one fails here, whatever order the modules register in.

import { beforeEach, describe, expect, it } from "vitest";
import type { Surface } from "../../../src/config/environments.ts";
import { createLogger } from "../../../src/log.ts";
import { createAccessVerifier } from "../../../src/providers/cloudflare-access.ts";
import { appFor, fakeDependencies, markDatabase, request, type TestDependencies } from "../helpers.ts";

const AN_ID = "0190f000-0000-7000-8000-000000000001";

/** The routes a caller with no session may reach, by surface: signing in, health, and the apps' error reports. */
const OPEN: Readonly<Record<"client" | "tech", readonly string[]>> = {
  client: [
    "GET /api/health",
    "POST /api/client-errors",
    "POST /api/auth/otp",
    "POST /api/auth/otp/resend",
    "POST /api/auth/otp/sms",
    "POST /api/auth/verify",
    "POST /api/auth/logout",
  ],
  tech: ["GET /api/health", "POST /api/client-errors", "POST /api/tech/auth/otp", "POST /api/tech/auth/verify"],
};

function routesOf(app: ReturnType<typeof appFor>): string[] {
  return app.openAPIRegistry.definitions
    .filter((definition) => definition.type === "route")
    .map((definition) => `${definition.route.method.toUpperCase()} ${definition.route.path}`);
}

/** Each route's answer to a caller with nothing to show: "401 GET /api/me". */
async function askEachRoute(surface: Surface, deps: TestDependencies = fakeDependencies()): Promise<string[]> {
  const app = appFor("local", deps, {}, surface);
  const answers: string[] = [];
  for (const route of routesOf(app)) {
    const [method = "GET", path = ""] = route.split(" ");
    const writes = method !== "GET" && method !== "HEAD";
    const response = await request(app, path.replace(/\{[^}]+\}/g, AN_ID), {
      method,
      headers: writes ? { Origin: "https://maneman.test", "Content-Type": "application/json" } : {},
      ...(writes ? { body: "{}" } : {}),
    });
    answers.push(`${String(response.status)} ${route}`);
  }
  return answers;
}

beforeEach(async () => {
  await markDatabase();
});

describe("a caller with no session", () => {
  it.each(["client", "tech"] as const)("is refused by every %s route but those that sign one in", async (surface) => {
    const answers = await askEachRoute(surface);
    const refused = answers.filter((answer) => answer.startsWith("401 ")).map((answer) => answer.slice(4));
    const open = answers.filter((answer) => !answer.startsWith("401 ")).map((answer) => answer.slice(4));
    expect(open.sort()).toEqual([...OPEN[surface]].sort());
    expect(refused.length).toBeGreaterThan(0);
  });

  it("is refused by every console route, Access having let nobody in", async () => {
    const access = createAccessVerifier(
      { teamDomain: "team.cloudflareaccess.com", opsAudience: "aud" },
      {
        fetch: () => Promise.reject(new Error("a call with no token needs no keys")),
        now: () => new Date(),
        log: createLogger(),
      },
    );
    const answers = await askEachRoute("ops", fakeDependencies({ access }));
    expect(answers.filter((answer) => !answer.startsWith("403 "))).toEqual([]);
  });
});
