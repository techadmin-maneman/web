// The ops console's pages, by path (apps/ops/src/route.ts): one table names
// every section, and the navigation, the router and the page titles all read
// it, so a section cannot be listed in one and missed in another.

import { describe, expect, it } from "vitest";
import {
  followsHere,
  landingPath,
  mayOpen,
  redirectOf,
  routeOf,
  SECTION_NAMES,
  SECTIONS,
  settingsPath,
  titleOf,
} from "../../apps/ops/src/route.ts";
import { ROUTE_NEEDS } from "../../src/policy/console-routes.ts";

const CLIENT = "22000000-0000-4000-8000-000000000001";

const namesIn = (department: string) =>
  SECTIONS.filter((section) => section.department === department).map((section) => SECTION_NAMES[section.page]);

describe("the ops console's routes", () => {
  it("opens every section at the path the navigation links to", () => {
    for (const section of SECTIONS) {
      expect(routeOf(section.path).page, section.path).toBe(section.page);
    }
  });

  it("lists the sections by department, Tasks first", () => {
    expect(namesIn("operations")).toEqual(["Tasks", "Dispatch", "Technicians", "Stock"]);
    expect(namesIn("customer_care")).toEqual(["Clients", "Grievances", "Number changes", "Deletion requests"]);
    expect(namesIn("finance")).toEqual(["Payments", "Prices", "Discount codes"]);
    expect(namesIn("growth")).toEqual(["Referrals", "Waitlist", "Service area"]);
    expect(namesIn("admin")).toEqual(["Settings", "Staff"]);
    expect(SECTIONS.map((section) => section.department)).toEqual([
      ...Array<string>(4).fill("operations"),
      ...Array<string>(4).fill("customer_care"),
      ...Array<string>(3).fill("finance"),
      ...Array<string>(3).fill("growth"),
      ...Array<string>(2).fill("admin"),
    ]);
  });

  // MON-16 and OIA-08 of the audit, 2 October 2026: the day's money sat under "No-shows".
  it("names the money section Payments, at the address it has always had", () => {
    expect(SECTION_NAMES[routeOf("/no-shows").page]).toBe("Payments");
    expect(titleOf(routeOf("/no-shows"))).toBe("Payments · Mane Man operations");
  });

  it("shows each section to those whose call opening its page is one the API lists", () => {
    for (const section of SECTIONS) {
      expect(Object.keys(ROUTE_NEEDS), section.page).toContain(section.reads);
    }
  });

  it("opens Settings' tabs and a client's tabs at their own paths", () => {
    expect(routeOf("/settings")).toEqual({ page: "settings", tab: "rules" });
    expect(routeOf(settingsPath("blackouts"))).toEqual({ page: "settings", tab: "blackouts" });
    expect(routeOf("/settings/consumables")).toEqual({ page: "settings", tab: "consumables" });
    expect(routeOf("/settings/job-sheet")).toEqual({ page: "settings", tab: "job-sheet" });
    expect(routeOf("/stock")).toEqual({ page: "stock" });
    expect(routeOf("/clients")).toEqual({ page: "clients", clientId: null, tab: "pieces" });
    expect(routeOf(`/clients/${CLIENT}/photos`)).toEqual({ page: "clients", clientId: CLIENT, tab: "photos" });
  });

  it("opens the pages that were Settings' tabs at their old addresses, and moves the address to the new one", () => {
    const moved = {
      "/settings/prices": "/prices",
      "/settings/discount-codes": "/discount-codes",
      "/settings/area": "/service-area",
      "/settings/staff": "/staff",
    };
    for (const [old, now] of Object.entries(moved)) {
      expect(routeOf(old), old).toEqual(routeOf(now));
      expect(redirectOf(old, null), old).toBe(now);
    }
  });

  it("opens Tasks for a path it does not know, or a name every object carries", () => {
    for (const path of ["/", "/nowhere", "/settings/nowhere", "/constructor", "/__proto__", "/toString"]) {
      expect(routeOf(path), path).toEqual({ page: "tasks" });
    }
  });

  it("titles each page by what it is, never by whom, so no two sections share a title (WCAG 2.4.2)", () => {
    expect(titleOf(routeOf("/"))).toBe("Tasks · Mane Man operations");
    expect(titleOf(routeOf("/settings/prices"))).toBe("Prices · Mane Man operations");
    expect(titleOf(routeOf("/settings/blackouts"))).toBe("Blackout days · Settings · Mane Man operations");
    expect(titleOf(routeOf(`/clients/${CLIENT}/consents`))).toBe("Consents · Clients · Mane Man operations");
    const titles = SECTIONS.map((section) => titleOf(routeOf(section.path)));
    expect(new Set(titles).size).toBe(SECTIONS.length);
  });
});

describe("what the console shows the person signed in", () => {
  const finance = new Set(["GET /api/health", "GET /api/whoami", "GET /api/no-shows", "GET /api/services"]);

  it("shows every section until the API has said what goes ahead", () => {
    for (const section of SECTIONS) expect(mayOpen(null, section.page)).toBe(true);
  });

  it("shows only the sections whose opening call goes ahead for them", () => {
    const open = SECTIONS.filter((section) => mayOpen(finance, section.page)).map((section) => section.page);
    expect(open).toEqual(["no-shows", "prices"]);
  });

  it("opens on Tasks, or for one who may not open it, the first section they may", () => {
    expect(landingPath(null)).toBe("/tasks");
    expect(landingPath(new Set(Object.keys(ROUTE_NEEDS)))).toBe("/tasks");
    expect(landingPath(finance)).toBe("/no-shows");
    expect(landingPath(new Set(["GET /api/whoami"]))).toBeNull();
  });

  it("moves a path with no page to where the console opens, once the API has said", () => {
    expect(redirectOf("/", null)).toBeNull();
    expect(redirectOf("/", finance)).toBe("/no-shows");
    expect(redirectOf("/nowhere", new Set(Object.keys(ROUTE_NEEDS)))).toBe("/tasks");
    expect(redirectOf("/waitlist", finance)).toBeNull();
    expect(redirectOf("/", new Set(["GET /api/whoami"]))).toBeNull();
  });
});

describe("a link within the console", () => {
  const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

  it("follows a plain click without a reload", () => {
    expect(followsHere(click)).toBe(true);
  });

  it("leaves a click that asks for a new tab or window to the browser", () => {
    expect(followsHere({ ...click, ctrlKey: true })).toBe(false);
    expect(followsHere({ ...click, metaKey: true })).toBe(false);
    expect(followsHere({ ...click, shiftKey: true })).toBe(false);
    expect(followsHere({ ...click, altKey: true })).toBe(false);
    expect(followsHere({ ...click, button: 1 })).toBe(false);
  });
});
