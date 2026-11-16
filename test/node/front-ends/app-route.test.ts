// The client app's pages, by path (apps/app/src/route.ts): every path the Worker answers opens a page, one the app
// does not know opens Home, and a path the app had before moves to its new place.

import { describe, expect, it } from "vitest";
import { movedTo, routeOf, tabOf } from "../../../apps/app/src/route.ts";

const VISIT = "a0000000-0000-4000-8000-000000000001";

describe("the client app’s routes", () => {
  it("opens each tab at its own path, with its tab marked", () => {
    expect(routeOf("/")).toEqual({ page: "home" });
    expect(routeOf("/visits")).toEqual({ page: "visits" });
    expect(routeOf("/photos")).toEqual({ page: "photos" });
    expect(routeOf("/rewards")).toEqual({ page: "rewards" });
    expect(tabOf({ page: "rewards" })).toBe("/rewards");
  });

  it("opens the profile and its pages, with no tab marked", () => {
    expect(routeOf("/profile")).toEqual({ page: "profile" });
    expect(routeOf("/profile/payments")).toEqual({ page: "payments" });
    expect(routeOf(`/profile/payments/${VISIT}`)).toEqual({ page: "entry", id: VISIT });
    expect(routeOf("/profile/address")).toEqual({ page: "address" });
    expect(routeOf("/profile/privacy")).toEqual({ page: "privacy" });
    expect(routeOf("/profile/account")).toEqual({ page: "account" });
    expect(tabOf({ page: "account" })).toBeNull();
  });

  it("opens one visit, one issue, raising one, the alerts and the hair system pages", () => {
    expect(routeOf(`/visits/${VISIT}`)).toEqual({ page: "visit", id: VISIT });
    expect(routeOf("/visits/issues")).toEqual({ page: "visits", show: "issues" });
    expect(routeOf(`/visits/issues/${VISIT}`)).toEqual({ page: "issue", id: VISIT });
    expect(routeOf("/visits/issues/MM-ISS-0032")).toEqual({ page: "issue", id: "MM-ISS-0032" });
    expect(routeOf("/visits/issues/MM-ISS-x")).toEqual({ page: "home" });
    expect(routeOf("/visits/issues/new")).toEqual({ page: "raise" });
    expect(routeOf("/rewards/invited")).toEqual({ page: "invited" });
    expect(routeOf("/alerts")).toEqual({ page: "alerts" });
    expect(routeOf("/hair-system")).toEqual({ page: "hairSystem" });
    expect(routeOf("/hair-systems")).toEqual({ page: "hairSystems" });
  });

  it("moves each path the app had before to its new place, so a link in a message already sent still opens", () => {
    expect(movedTo("/payments")).toBe("/profile/payments");
    expect(movedTo(`/payments/${VISIT}/`)).toBe(`/profile/payments/${VISIT}`);
    expect(movedTo("/refer")).toBe("/rewards");
    expect(movedTo("/refer/fitted")).toBe("/rewards/invited");
    expect(movedTo("/replacement")).toBe("/hair-system");
    expect(movedTo("/photos/compare")).toBe("/photos");
    expect(movedTo("/visits")).toBeNull();
    expect(movedTo("/payments/not-an-entry")).toBeNull();
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
      expect(movedTo(`/${name}`)).toBeNull();
    }
  });
});
