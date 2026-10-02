// Every ops route asks for a department and a level (src/policy/console-routes.ts). A route the table does not list
// is refused once the Staff list is enforced, so a route added without a line here would be shut to everyone: this
// names it first.

import { describe, expect, it } from "vitest";
import opsDocument from "../../docs/openapi-ops.json";
import { needOf, ROUTE_NEEDS, SIGNED_IN } from "../../src/policy/console-routes.ts";

const METHODS = ["get", "post", "put", "patch", "delete"];

const documented = Object.entries(opsDocument.paths as Record<string, Record<string, unknown>>).flatMap(
  ([path, operations]) =>
    Object.keys(operations)
      .filter((method) => METHODS.includes(method))
      .map((method) => `${method.toUpperCase()} ${path}`),
);

describe("what each ops route asks of its caller", () => {
  it("is set for every route the ops console's API has", () => {
    expect(documented.filter((route) => !(route in ROUTE_NEEDS))).toEqual([]);
  });

  it("names no route the API does not have", () => {
    expect(Object.keys(ROUTE_NEEDS).filter((route) => !documented.includes(route))).toEqual([]);
  });

  it("is found from Hono's path, whose placeholders begin with a colon", () => {
    expect(needOf("get", "/api/clients/:id/photos/:photo_id")).toEqual({ department: "customer_care", level: "view" });
    expect(needOf("POST", "/api/deletion-requests/:id/decision")).toEqual({
      department: "customer_care",
      level: "manage",
    });
    expect(needOf("GET", "/api/*")).toBeUndefined();
    expect(needOf("GET", "/constructor")).toBeUndefined();
  });

  it("asks of HEAD what it asks of GET, since Hono answers HEAD with the GET route", () => {
    expect(needOf("HEAD", "/api/health")).toBe(SIGNED_IN);
    expect(needOf("HEAD", "/api/grievances")).toEqual({ department: "customer_care", level: "view" });
  });

  it("asks MANAGE of what gives money back, waives it, or sets prices, codes, settings, erasures and access", () => {
    const manage = Object.entries(ROUTE_NEEDS)
      .filter(([, need]) => typeof need === "object" && need.level === "manage")
      .map(([route]) => route);
    expect(manage).toEqual(
      expect.arrayContaining([
        "POST /api/held-bookings/{id}/refund",
        "POST /api/clients/{id}/credits",
        "POST /api/prices",
        "POST /api/discount-codes",
        "POST /api/settings/{name}",
        "POST /api/deletion-requests/{id}/decision",
        "POST /api/staff",
      ]),
    );
  });
});
