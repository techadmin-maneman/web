// The ops console's pages, by path (apps/ops/src/route.ts): one table names
// every section, and the navigation, the router and the page titles all read
// it, so a section cannot be listed in one and missed in another.

import { describe, expect, it } from "vitest";
import { followsHere, routeOf, SECTION_NAMES, SECTIONS, settingsPath, titleOf } from "../../apps/ops/src/route.ts";

const CLIENT = "22000000-0000-4000-8000-000000000001";

describe("the ops console's routes", () => {
  it("opens every section at the path the navigation links to", () => {
    for (const section of SECTIONS) {
      expect(routeOf(section.path).page, section.path).toBe(section.page);
    }
  });

  it("names every section in the navigation, in the design's order", () => {
    expect(SECTIONS.map((section) => SECTION_NAMES[section.page])).toEqual([
      "Dispatch",
      "Clients",
      "No-shows",
      "Referrals",
      "Waitlist",
      "Tasks",
      "Technicians",
      "Stock",
      "Grievances",
      "Deletion requests",
      "Number changes",
      "Settings",
    ]);
  });

  it("opens Settings' tabs and a client's tabs at their own paths", () => {
    expect(routeOf("/settings")).toEqual({ page: "settings", tab: "rules" });
    expect(routeOf(settingsPath("prices"))).toEqual({ page: "settings", tab: "prices" });
    expect(routeOf(settingsPath("area"))).toEqual({ page: "settings", tab: "area" });
    expect(routeOf("/settings/consumables")).toEqual({ page: "settings", tab: "consumables" });
    expect(routeOf("/settings/job-sheet")).toEqual({ page: "settings", tab: "job-sheet" });
    expect(routeOf(settingsPath("discount-codes"))).toEqual({ page: "settings", tab: "discount-codes" });
    expect(routeOf("/stock")).toEqual({ page: "stock" });
    expect(routeOf("/clients")).toEqual({ page: "clients", clientId: null, tab: "pieces" });
    expect(routeOf(`/clients/${CLIENT}/photos`)).toEqual({ page: "clients", clientId: CLIENT, tab: "photos" });
  });

  it("opens the dispatch board for a path it does not know, or a name every object carries", () => {
    for (const path of ["/", "/nowhere", "/settings/nowhere", "/constructor", "/__proto__", "/toString"]) {
      expect(routeOf(path), path).toEqual({ page: "dispatch" });
    }
  });

  it("titles each page by what it is, never by whom, so no two sections share a title (WCAG 2.4.2)", () => {
    expect(titleOf(routeOf("/"))).toBe("Dispatch · Mane Man operations");
    expect(titleOf(routeOf("/settings/prices"))).toBe("Services and prices · Settings · Mane Man operations");
    expect(titleOf(routeOf(`/clients/${CLIENT}/consents`))).toBe("Consents · Clients · Mane Man operations");
    const titles = SECTIONS.map((section) => titleOf(routeOf(section.path)));
    expect(new Set(titles).size).toBe(SECTIONS.length);
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
