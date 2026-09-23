// The technician app is built beside the technician API, not after it. This
// test is how the two are kept honest until `docs/openapi-tech.json` exists:
// every route the app calls must be one the P2-M4 section of the backend prompt
// writes, and the handful it does not write must be declared as assumed.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROUTES_ASSUMED, ROUTES_SPECIFIED } from "../../apps/tech/src/routes.ts";

const prompt = readFileSync("docs/prompts/phase2-backend.md", "utf8");

/** The prompt's technician list: from its heading to the dispatch list that follows it. */
const technicianSection = (() => {
  const from = prompt.indexOf("**Technician** (`tech.maneman.in/api/*`");
  const to = prompt.indexOf("**Dispatch and pieces**", from);
  expect(from, "the prompt's technician list moved").toBeGreaterThan(-1);
  expect(to, "the prompt's dispatch list moved").toBeGreaterThan(from);
  return prompt.slice(from, to);
})();

describe("the routes the technician app assumes", () => {
  it.each(ROUTES_SPECIFIED)("$method $path is written in the prompt as $prompt", (route) => {
    expect(technicianSection).toContain(route.prompt);
  });

  it("calls every route the prompt's technician list writes", () => {
    // The prompt writes one route per line with a leading `POST` or `GET`; the three
    // sub-paths on the checklist line are counted with it.
    const written = [...technicianSection.matchAll(/`(GET|POST) (\/tech\/[^`]*)`/g)].map(
      (match) => `${match[1] ?? ""} ${(match[2] ?? "").replace(/\?.*$/, "")}`,
    );
    const called = new Set(ROUTES_SPECIFIED.map((route) => `${route.method} ${route.path}`));
    expect(written.filter((route) => !called.has(route))).toEqual([]);
  });

  it("declares as assumed every route the prompt does not write", () => {
    for (const route of ROUTES_ASSUMED) {
      expect(technicianSection, `${route.method} ${route.path} is in the prompt after all`).not.toContain(route.path);
    }
    // Two, and no more, until the real document settles them: GET /tech/me and POST /tech/auth/logout.
    expect(ROUTES_ASSUMED.map((route) => `${route.method} ${route.path}`)).toEqual([
      "GET /tech/me",
      "POST /tech/auth/logout",
    ]);
  });

  it("carries the client-generated event ID the prompt requires on every write", () => {
    expect(technicianSection).toContain("X-Client-Event-Id");
  });
});
