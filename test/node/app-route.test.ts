// The client app's pages, by path (apps/app/src/route.ts): every path the
// Worker answers opens a page, and one the app does not know opens Home.

import { describe, expect, it } from "vitest";
import { routeOf, tabOf } from "../../apps/app/src/route.ts";

const VISIT = "a0000000-0000-4000-8000-000000000001";

describe("the client app's routes", () => {
  it("opens each tab and the profile at its own path", () => {
    expect(routeOf("/")).toEqual({ page: "home" });
    expect(routeOf("/visits")).toEqual({ page: "visits" });
    expect(routeOf("/photos")).toEqual({ page: "photos" });
    expect(routeOf("/payments")).toEqual({ page: "payments" });
    expect(routeOf("/refer")).toEqual({ page: "refer" });
    expect(routeOf("/profile")).toEqual({ page: "profile" });
  });

  it("opens one visit, one entry, the compare and who has been fitted", () => {
    expect(routeOf(`/visits/${VISIT}`)).toEqual({ page: "visit", id: VISIT });
    expect(routeOf(`/payments/${VISIT}`)).toEqual({ page: "entry", id: VISIT });
    expect(routeOf("/photos/compare")).toEqual({ page: "compare" });
    expect(routeOf("/refer/fitted")).toEqual({ page: "fitted" });
  });

  it("opens Home for a path it does not know", () => {
    expect(routeOf("/nowhere")).toEqual({ page: "home" });
    expect(routeOf("/visits/not-a-visit")).toEqual({ page: "home" });
    expect(routeOf(`/visits/${VISIT}/more`)).toEqual({ page: "home" });
  });

  it("opens Home, not a blank page, for a name every JavaScript object carries", () => {
    for (const name of ["constructor", "toString", "hasOwnProperty", "__proto__", "valueOf"]) {
      const route = routeOf(`/${name}`);
      expect(route).toEqual({ page: "home" });
      expect(tabOf(route)).toBe("/");
    }
  });
});
