// Every ops route asks for a department and a level (src/policy/console-routes.ts). A route the table does not list
// is refused once the Staff list is enforced, so a route added without a line here would be shut to everyone: this
// names it first.

import { describe, expect, it } from "vitest";
import opsDocument from "../../docs/openapi-ops.json";
import { NATIONAL, type Caller, type Department, type Level } from "../../src/policy/access.ts";
import {
  meetsNeed,
  needOf,
  ROUTE_NEEDS,
  routesOpenTo,
  SIGNED_IN,
  TASK_DEPARTMENTS,
  taskNeed,
  type RouteNeed,
} from "../../src/policy/console-routes.ts";

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
        "POST /api/technicians",
        "POST /api/technicians/{id}/reactivate",
      ]),
    );
  });

  it("gives the price book to Finance, while changing a service stays Admin's", () => {
    expect(ROUTE_NEEDS["GET /api/services"]).toEqual({ department: "finance", level: "view" });
    expect(ROUTE_NEEDS["POST /api/services"]).toEqual({ department: "admin", level: "manage" });
  });
});

describe("the routes a caller's calls go ahead on", () => {
  const NO_ZONES = new Map<string, string>();
  /** The health check, who is signed in, and the console's own errors: open to anyone Access lets in. */
  const SIGNED_IN_ROUTES = ["GET /api/health", "GET /api/whoami", "POST /api/client-errors"];
  const financeInDelhi: Caller = {
    kind: "person",
    active: true,
    grants: [{ department: "finance", level: "manage", place: { geography: "city", name: "Delhi" } }],
  };
  const adminInDelhi: Caller = {
    kind: "person",
    active: true,
    grants: [{ department: "admin", level: "view", place: { geography: "city", name: "Delhi" } }],
  };

  it("are every route while the list is not enforced", () => {
    expect(routesOpenTo(financeInDelhi, false, NO_ZONES)).toEqual(Object.keys(ROUTE_NEEDS));
  });

  it("are, once enforced, only those a city's grant reaches: the ones that keep to the caller's places", () => {
    expect(routesOpenTo(financeInDelhi, true, NO_ZONES)).toEqual(SIGNED_IN_ROUTES);
    expect(routesOpenTo(adminInDelhi, true, NO_ZONES)).toEqual([...SIGNED_IN_ROUTES, "GET /api/staff"]);
  });

  it("are every route for a service token on the list, and none but the signed-in ones for one not on it", () => {
    expect(routesOpenTo({ kind: "service", allowed: true }, true, NO_ZONES)).toEqual(Object.keys(ROUTE_NEEDS));
    expect(routesOpenTo({ kind: "service", allowed: false }, true, NO_ZONES)).toEqual(SIGNED_IN_ROUTES);
  });
});

describe("Tasks, where each department sees the groups it decides", () => {
  const NO_ZONES = new Map<string, string>();
  const holding = (...grants: (readonly [Department, Level])[]): Caller => ({
    kind: "person",
    active: true,
    grants: grants.map(([department, level]) => ({ department, level, place: NATIONAL })),
  });
  const routeNeed = (route: string): RouteNeed => {
    const need = ROUTE_NEEDS[route];
    if (need === undefined || need === SIGNED_IN) throw new Error(`${route} asks no department`);
    return need;
  };

  it("opens the board to View in any department, nationally", () => {
    const board = routeNeed("GET /api/tasks");
    expect(meetsNeed(holding(["growth", "view"]), board, NO_ZONES)).toBe(true);
    expect(meetsNeed(holding(), board, NO_ZONES)).toBe(false);
    const delhi: Caller = {
      kind: "person",
      active: true,
      grants: [{ department: "growth", level: "manage", place: { geography: "city", name: "Delhi" } }],
    };
    expect(meetsNeed(delhi, board, NO_ZONES)).toBe(false);
  });

  it("gives each group to the department that decides it", () => {
    expect(TASK_DEPARTMENTS.held_booking).toBe("operations");
    expect(TASK_DEPARTMENTS.grievance).toBe("customer_care");
    expect(TASK_DEPARTMENTS.no_show_decision).toBe("finance");
    expect(TASK_DEPARTMENTS.referral_review).toBe("growth");
  });

  it("takes a task only with Act in the department that decides its group", () => {
    const care = holding(["customer_care", "act"], ["finance", "view"]);
    expect(meetsNeed(care, routeNeed("PUT /api/tasks/{group}/{id}/owner"), NO_ZONES)).toBe(true);
    expect(meetsNeed(care, taskNeed("grievance", "act"), NO_ZONES)).toBe(true);
    expect(meetsNeed(care, taskNeed("no_show_decision", "act"), NO_ZONES)).toBe(false);
    expect(meetsNeed(holding(["customer_care", "view"]), taskNeed("grievance", "act"), NO_ZONES)).toBe(false);
  });

  it("names the board among a Finance viewer's routes, but not taking a task of it", () => {
    const routes = routesOpenTo(holding(["finance", "view"]), true, NO_ZONES);
    expect(routes).toContain("GET /api/tasks");
    expect(routes).not.toContain("PUT /api/tasks/{group}/{id}/owner");
  });
});
