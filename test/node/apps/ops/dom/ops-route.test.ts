// The ops console's pages, by path (apps/ops/src/route.ts): one table names every page of work, one the navigation's
// entries over them and one Settings' pages, and the navigation, the router and the page titles all read them, so a
// page cannot be listed in one and missed in another.

import { describe, expect, it } from "vitest";
import {
  clientPath,
  dispatchAsked,
  dispatchPath,
  firstSetting,
  followsHere,
  keyOf,
  landingPath,
  mayOpen,
  mayOpenSetting,
  NAV,
  NAV_NAMES,
  redirectOf,
  routeOf,
  rulePath,
  SECTION_NAMES,
  SECTIONS,
  settingsPath,
  SETTINGS_PAGE_NAMES,
  SETTINGS_PAGES,
  technicianPath,
  titleOf,
} from "../../../../../apps/ops/src/route.ts";
import { RULE_GROUPS } from "../../../../../apps/ops/src/settings/rule-groups.ts";
import { ROUTE_NEEDS } from "../../../../../src/policy/console-routes.ts";

const CLIENT = "22000000-0000-4000-8000-000000000001";
const TECHNICIAN = "88000000-0000-4000-8000-000000000001";
const VISIT = "99000000-0000-4000-8000-000000000001";

describe("the ops console’s routes", () => {
  it("opens every page of work at the path the navigation links to", () => {
    for (const section of SECTIONS) {
      expect(routeOf(section.path).page, section.path).toBe(section.page);
    }
  });

  it("lists the work first, a job an entry, and every page under exactly one", () => {
    expect(NAV.map((entry) => NAV_NAMES[entry.entry])).toEqual([
      "Today",
      "Tasks",
      "Dispatch",
      "Clients",
      "Messages",
      "Technicians",
      "Inventory",
      "Requests",
      "Money",
      "Growth",
      "Reports",
    ]);
    const listed = NAV.flatMap((entry) => entry.pages as readonly string[]);
    expect([...listed].sort()).toEqual(SECTIONS.map((section) => section.page).sort());
    expect(NAV.find((entry) => entry.entry === "inventory")?.pages.map((page) => SECTION_NAMES[page])).toEqual([
      "Stock",
      "Counts",
      "Purchasing",
      "Supply plan",
      "Quality",
      "Usage",
      "Items",
      "Suppliers",
    ]);
  });

  it("holds everything the console is set up with in Settings, by group, and none of it in the work", () => {
    const work = SECTIONS.map((section) => section.path);
    for (const old of ["/prices", "/discount-codes", "/staff", "/cities", "/targets", "/words", "/care-settings"]) {
      expect(work, old).not.toContain(old);
    }
    expect(SETTINGS_PAGES.map((page) => page.group)).toEqual([
      ...Array<string>(3).fill("business"),
      ...Array<string>(3).fill("scheduling"),
      ...Array<string>(4).fill("visits"),
      ...Array<string>(3).fill("prices"),
      ...Array<string>(4).fill("growth"),
      ...Array<string>(4).fill("care"),
      ...Array<string>(3).fill("inventory"),
      ...Array<string>(2).fill("team"),
      ...Array<string>(3).fill("system"),
    ]);
  });

  it("draws every rule group on one of Settings' pages, and each on one alone", () => {
    const drawn = SETTINGS_PAGES.flatMap((page) => ("rules" in page ? [...page.rules] : []));
    for (const group of RULE_GROUPS)
      expect(
        drawn.filter((id) => id === group.id),
        group.id,
      ).toHaveLength(1);
  });

  // The day's money sat under "No-shows".
  it("names the money page Charges, at the address it has always had", () => {
    expect(routeOf("/payments")).toEqual({ page: "payments" });
    expect(SECTION_NAMES.payments).toBe("Charges");
    expect(titleOf(routeOf("/payments"))).toBe("Charges · Mane Man Ops");
  });

  it("shows each page to those whose call opening it is one the API lists", () => {
    for (const section of SECTIONS) expect(Object.keys(ROUTE_NEEDS), section.page).toContain(section.reads);
    for (const page of SETTINGS_PAGES) expect(Object.keys(ROUTE_NEEDS), page.tab).toContain(page.reads);
  });

  it("opens each of Settings' pages and a client’s tabs at their own paths", () => {
    expect(routeOf(settingsPath("closed-days"))).toEqual({ page: "settings", tab: "closed-days" });
    expect(routeOf("/settings/job-sheet")).toEqual({ page: "settings", tab: "job-sheet" });
    expect(routeOf("/settings/nowhere")).toEqual({ page: "today" });
    expect(routeOf("/stock")).toEqual({ page: "stock" });
    expect(routeOf(`/clients/${CLIENT}/photos`)).toEqual({ page: "clients", clientId: CLIENT, tab: "photos" });
  });

  it("links to a rule on the page of Settings that holds it", () => {
    expect(rulePath("late_change_charge")).toBe("/settings/moves#late_change_charge");
    expect(rulePath("daily_ceilings")).toBe("/settings/limits#daily_ceilings");
    expect(rulePath("task_sla_hours")).toBe("/settings/console#task_sla_hours");
  });

  // A client's page opened on an empty Pieces tab, and so did every bare link.
  it("opens a client’s page on their visits, and names the tab of every link to it", () => {
    expect(routeOf("/clients")).toEqual({ page: "clients", clientId: null, tab: "visits" });
    expect(routeOf(`/clients/${CLIENT}`)).toEqual({ page: "clients", clientId: CLIENT, tab: "visits" });
    expect(clientPath(CLIENT, "visits")).toBe(`/clients/${CLIENT}/visits`);
    expect(routeOf(clientPath(CLIENT, "referrals"))).toEqual({ page: "clients", clientId: CLIENT, tab: "referrals" });
  });

  it("opens a technician’s page on their week, and each of its tabs at its own path", () => {
    expect(routeOf("/technicians")).toEqual({ page: "technicians", technicianId: null, tab: "week" });
    expect(routeOf(technicianPath(TECHNICIAN))).toEqual({ page: "technicians", technicianId: TECHNICIAN, tab: "week" });
    expect(routeOf(technicianPath(TECHNICIAN, "kit"))).toEqual({
      page: "technicians",
      technicianId: TECHNICIAN,
      tab: "kit",
    });
    expect(routeOf(`/technicians/${TECHNICIAN}/nowhere`)).toEqual({ page: "today" });
    // Their tabs share one key, so moving between them does not read the roster again.
    expect(keyOf(routeOf(technicianPath(TECHNICIAN, "leave")))).toBe(keyOf(routeOf(technicianPath(TECHNICIAN))));
    expect(keyOf(routeOf("/technicians"))).not.toBe(keyOf(routeOf(technicianPath(TECHNICIAN))));
  });

  it("links to the dispatch board on a week, a city, a search and a visit, and reads every part back", () => {
    const nothing = { from: null, city: null, find: "", visit: null };
    expect(dispatchPath({})).toBe("/dispatch");
    expect(dispatchPath(nothing)).toBe("/dispatch");
    const asked = { from: "2027-10-04", city: "Gurgaon", find: "Rohit", visit: VISIT };
    const path = dispatchPath(asked);
    expect(path).toBe(`/dispatch?from=2027-10-04&city=Gurgaon&find=Rohit&visit=${VISIT}`);
    expect(dispatchAsked(path.slice(path.indexOf("?")))).toEqual(asked);
    expect(dispatchAsked("?from=next-week")).toEqual(nothing);
    expect(dispatchAsked("?visit=not-a-visit&city=%20")).toEqual(nothing);
  });

  it("opens the pages that moved at their old addresses, and moves the address to the new one", () => {
    const moved = {
      "/prices": "/settings/services",
      "/settings/prices": "/settings/services",
      "/discount-codes": "/settings/discount-codes",
      "/staff": "/settings/staff",
      "/cities": "/settings/cities",
      "/targets": "/settings/targets",
      "/words": "/settings/words",
      "/care-settings": "/settings/care-team",
      "/settings/blackouts": "/settings/closed-days",
      "/settings/area": "/settings/areas",
      "/service-area": "/settings/areas",
      "/areas/served": "/settings/areas",
      "/areas": "/waitlist",
      "/no-shows": "/payments",
      "/settings/consumables": "/items",
    };
    for (const [old, now] of Object.entries(moved)) {
      expect(routeOf(old), old).toEqual(routeOf(now));
      expect(redirectOf(old, null), old).toBe(now);
    }
  });

  it("moves an old link to a rule to the page of Settings that holds it", () => {
    expect(redirectOf("/settings", null, "#no_show_wait_min")).toBe("/settings/field#no_show_wait_min");
  });

  it("opens Today for a path it does not know, or a name every object carries", () => {
    for (const path of ["/", "/nowhere", "/settings/nowhere", "/constructor", "/__proto__", "/toString"]) {
      expect(routeOf(path), path).toEqual({ page: "today" });
    }
  });

  it("titles each page by what it is, never by whom, so no two share a title (WCAG 2.4.2)", () => {
    expect(titleOf(routeOf("/"))).toBe("Today · Mane Man Ops");
    expect(titleOf(routeOf("/settings/services"))).toBe("Consultation and fees · Settings · Mane Man Ops");
    expect(titleOf(routeOf("/settings/packages"))).toBe("Packages · Settings · Mane Man Ops");
    expect(titleOf(routeOf("/settings/stock"))).toBe("Stock · Settings · Mane Man Ops");
    expect(titleOf(routeOf("/stock"))).toBe("Stock · Mane Man Ops");
    expect(titleOf(routeOf(`/clients/${CLIENT}/consents`))).toBe("Consents · Clients · Mane Man Ops");
    expect(titleOf(routeOf(technicianPath(TECHNICIAN, "phones")))).toBe("Phones · Technicians · Mane Man Ops");
    const titles = [
      ...SECTIONS.map((section) => titleOf(routeOf(section.path))),
      ...SETTINGS_PAGES.map((page) => titleOf(routeOf(settingsPath(page.tab)))),
    ];
    expect(new Set(titles).size).toBe(SECTIONS.length + SETTINGS_PAGES.length);
    expect(Object.keys(SETTINGS_PAGE_NAMES)).toHaveLength(SETTINGS_PAGES.length);
  });
});

describe("what the console shows the person signed in", () => {
  const finance = new Set(["GET /api/health", "GET /api/whoami", "GET /api/no-shows", "GET /api/services"]);
  const careViewer = new Set(["GET /api/health", "GET /api/whoami", "GET /api/conversations", "GET /api/care-team"]);

  it("shows every page until the API has said what goes ahead", () => {
    for (const section of SECTIONS) expect(mayOpen(null, section.page)).toBe(true);
    for (const page of SETTINGS_PAGES) expect(mayOpenSetting(null, page.tab)).toBe(true);
  });

  it("shows only the pages whose opening call goes ahead for them", () => {
    expect(SECTIONS.filter((section) => mayOpen(finance, section.page)).map((section) => section.page)).toEqual([
      "payments",
    ]);
    expect(SETTINGS_PAGES.filter((page) => mayOpenSetting(finance, page.tab)).map((page) => page.tab)).toEqual([
      "services",
    ]);
  });

  // Care holds no Admin grant: its own Settings page opens, the policies Admin keeps do not.
  it("opens Settings on the first page the person may open, and nowhere for one who may open none", () => {
    expect(firstSetting(careViewer)).toBe("care-team");
    expect(firstSetting(finance)).toBe("services");
    expect(firstSetting(new Set(["GET /api/whoami"]))).toBeNull();
    expect(redirectOf("/settings", careViewer)).toBe("/settings/care-team");
    expect(redirectOf("/settings", new Set(["GET /api/whoami", "GET /api/no-shows"]))).toBe("/payments");
  });

  it("opens on Today, or for one who may not open it, the first page they may", () => {
    expect(landingPath(null)).toBe("/today");
    expect(landingPath(new Set(Object.keys(ROUTE_NEEDS)))).toBe("/today");
    expect(landingPath(finance)).toBe("/payments");
    expect(landingPath(new Set(["GET /api/whoami"]))).toBeNull();
  });

  it("moves a path with no page to where the console opens, once the API has said", () => {
    expect(redirectOf("/", null)).toBeNull();
    expect(redirectOf("/", finance)).toBe("/payments");
    expect(redirectOf("/nowhere", new Set(Object.keys(ROUTE_NEEDS)))).toBe("/today");
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
