// The technician app was built beside the technician API, not after it. This
// test is what keeps the two honest, and it now has the document to do it with:
// every route the app calls must be one `docs/openapi-tech.json` writes, at the
// method it writes it at, and nothing may be left assumed.
//
// It also pins the four things P2-M4 and the app's shell disagreed about
// (`docs/open-points.md`, item 132), so neither side can quietly drop one.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EVENT_ID_HEADER, pathFor, ROUTES, ROUTES_ASSUMED, type EventKind } from "../../apps/tech/src/routes.ts";

interface Document {
  paths: Record<string, Record<string, { responses: Record<string, { description?: string }> }>>;
  components: { schemas: Record<string, unknown> };
}

const document = JSON.parse(readFileSync("docs/openapi-tech.json", "utf8")) as Document;

/** The API's document writes each path under /api; the app's client adds that prefix. */
const documented = (route: { method: string; path: string }) =>
  document.paths[`/api${route.path}`]?.[route.method.toLowerCase()];

describe("the routes the technician app calls", () => {
  it.each(ROUTES.map((route) => [`${route.method} ${route.path}`, route] as const))(
    "%s is in the technician API's document",
    (_name, route) => {
      expect(documented(route), `${route.method} /api${route.path} is not in docs/openapi-tech.json`).toBeDefined();
    },
  );

  it("assumes no route at all: the document settles every one of them", () => {
    expect(ROUTES_ASSUMED).toEqual([]);
  });

  it("sends each of the outbox's events to a route the document writes", () => {
    const job = "00000000-0000-7000-8000-000000000000";
    const kinds: EventKind[] = [
      "check_in",
      "start",
      "before_photos",
      "after_photos",
      "checklist",
      "consumables",
      "piece",
      "outcome",
      "no_show",
    ];
    for (const kind of kinds) {
      const path = `/api${pathFor(kind, job)}`.replace(job, "{id}");
      expect(document.paths[path]?.post, `${kind} goes to ${path}`).toBeDefined();
    }
  });
});

describe("what P2-M4 and the app's shell disagreed about", () => {
  it("has GET /api/tech/me, which the app asks every time it opens", () => {
    expect(document.paths["/api/tech/me"]?.get).toBeDefined();
    expect(document.components.schemas.TechnicianMe).toBeDefined();
  });

  it("has POST /api/tech/auth/logout, which ends the session on this phone", () => {
    expect(document.paths["/api/tech/auth/logout"]?.post).toBeDefined();
  });

  it("answers `device_revoked` on a 401, so a revoked phone is told which it was", () => {
    const revoked = Object.values(document.paths)
      .flatMap((methods) => Object.values(methods))
      .map((operation) => operation.responses["401"]?.description ?? "")
      .filter((description) => description.includes("device_revoked"));
    expect(revoked.length).toBeGreaterThan(0);
    // The app's own constant, so the two cannot drift apart.
    expect(readFileSync("apps/tech/src/routes.ts", "utf8")).toContain('DEVICE_REVOKED = "device_revoked"');
  });

  it("answers `technician_inactive` on /me's 401, so a switched-off technician's phone keeps his unsent work", () => {
    expect(document.paths["/api/tech/me"]?.get?.responses["401"]?.description).toContain("technician_inactive");
    expect(readFileSync("apps/tech/src/routes.ts", "utf8")).toContain('TECHNICIAN_INACTIVE = "technician_inactive"');
  });

  it("binds the session to the phone, which names itself on both login calls", () => {
    const schemas = document.components.schemas as Record<string, { properties?: Record<string, unknown> }>;
    expect(schemas.TechnicianLoginRequest?.properties).toHaveProperty("device_id");
    expect(schemas.TechnicianVerifyRequest?.properties).toHaveProperty("device_id");
    const login = readFileSync("apps/tech/src/api.ts", "utf8");
    expect(login).toContain("device_id: deviceId");
  });
});

describe("every write is idempotent on the phone's own event ID", () => {
  it("carries the header the API makes each write idempotent on", () => {
    const written = JSON.stringify(document).includes(EVENT_ID_HEADER.toLowerCase());
    expect(written, `${EVENT_ID_HEADER} is not in the document`).toBe(true);
  });
});
