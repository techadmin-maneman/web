// The console's pages, by path. Links change the path without a reload; the
// Worker answers every path with the console, so a page can be opened directly.
//
// SECTIONS below is the one list of them, in the navigation's order: by
// department, Tasks first. The navigation draws it, routeOf reads it, and each
// page is titled from it. Three sections have pages beneath them:
//
//   /clients/:id/:tab       a client's page, a tab at a time
//   /technicians/:id/:tab   a technician's page: his week, leave, phones and kit
//   /settings/:tab          the rules, blackout days, consumables and the job sheet
//
// Anything else, "/" included, is where the console opens: Tasks, or for a
// person who may not open Tasks, the first section they may.

import { clients, settings, shell, technicians } from "./content.ts";
import type { Department } from "./settings/grants.ts";

/** The router the apps share (packages/ui/router.tsx): the console's pages take it from here. */
export { followsHere, go, redirect, usePath, type Click } from "@maneman/ui/router";

interface SectionShape {
  readonly page: string;
  readonly path: string;
  readonly department: Department;
  /** The call its page opens with, as src/policy/console-routes.ts names it: shown to those whose calls to it go ahead. */
  readonly reads: string;
}

export const SECTIONS = [
  { page: "tasks", path: "/tasks", department: "operations", reads: "GET /api/tasks" },
  { page: "dispatch", path: "/dispatch", department: "operations", reads: "GET /api/dispatch" },
  { page: "technicians", path: "/technicians", department: "operations", reads: "GET /api/technicians" },
  { page: "stock", path: "/stock", department: "operations", reads: "GET /api/stock" },
  { page: "clients", path: "/clients", department: "customer_care", reads: "POST /api/clients/find" },
  { page: "grievances", path: "/grievances", department: "customer_care", reads: "GET /api/grievances" },
  { page: "number-changes", path: "/number-changes", department: "customer_care", reads: "GET /api/number-changes" },
  {
    page: "deletion-requests",
    path: "/deletion-requests",
    department: "customer_care",
    reads: "GET /api/deletion-requests",
  },
  { page: "no-shows", path: "/no-shows", department: "finance", reads: "GET /api/no-shows" },
  { page: "prices", path: "/prices", department: "finance", reads: "GET /api/services" },
  { page: "discount-codes", path: "/discount-codes", department: "finance", reads: "GET /api/discount-codes" },
  { page: "referrals", path: "/referrals", department: "growth", reads: "GET /api/referrals/held" },
  { page: "waitlist", path: "/waitlist", department: "growth", reads: "GET /api/waitlist" },
  { page: "service-area", path: "/service-area", department: "growth", reads: "GET /api/service-area" },
  { page: "settings", path: "/settings", department: "admin", reads: "GET /api/settings" },
  { page: "staff", path: "/staff", department: "admin", reads: "GET /api/staff" },
] as const satisfies readonly SectionShape[];

export type Section = (typeof SECTIONS)[number];
export type Page = Section["page"];
export type SectionPath = Section["path"];

/** A section that is one page, with nothing beneath it. */
export type PlainPage = Exclude<Page, "clients" | "settings" | "technicians">;

/**
 * The tabs of the design's eight that a client's page carries, in its order,
 * and History last: the board draws no such tab, so it stands after the ones
 * it does draw (docs/fidelity-method.md). The page opens on Pieces, as the
 * board draws it.
 */
export const CLIENT_TABS = ["visits", "pieces", "payments", "consents", "photos", "history"] as const;
export type ClientTab = (typeof CLIENT_TABS)[number];
const OPENING_TAB: ClientTab = "pieces";

/** A technician's page, a tab at a time, in its order. It opens on his week. */
export const TECHNICIAN_TABS = ["week", "leave", "phones", "kit"] as const;
export type TechnicianTab = (typeof TECHNICIAN_TABS)[number];

/** What Settings holds, in the order the section lists it. Rules has the section's own path. */
export const SETTINGS_TABS = ["rules", "blackouts", "consumables", "job-sheet"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export type Route =
  | { readonly page: PlainPage }
  | { readonly page: "settings"; readonly tab: SettingsTab }
  | { readonly page: "clients"; readonly clientId: string | null; readonly tab: ClientTab }
  | { readonly page: "technicians"; readonly technicianId: string | null; readonly tab: TechnicianTab };

const TASKS: Route = { page: "tasks" };
const CLIENT_PATH = /^\/clients(?:\/([0-9a-f-]{36})(?:\/(visits|pieces|payments|photos|consents|history))?)?$/;
const SETTINGS_PATH = /^\/settings(?:\/(blackouts|consumables|job-sheet))?$/;
const TECHNICIAN_PATH = /^\/technicians(?:\/([0-9a-f-]{36})(?:\/(week|leave|phones|kit))?)?$/;

/** Settings tabs that became pages of their own departments, so a link or bookmark to one still lands. */
const MOVED: Readonly<Record<string, string>> = {
  "/settings/prices": "/prices",
  "/settings/discount-codes": "/discount-codes",
  "/settings/area": "/service-area",
  "/settings/staff": "/staff",
};

/** Where a page that has moved is now; null for a path that has not moved. */
export function movedTo(path: string): string | null {
  if (!Object.hasOwn(MOVED, path)) return null;
  return MOVED[path] ?? null;
}

/** The tab a client's path names; Pieces without one, as the board draws the page. */
const clientTabOf = (named: string | undefined): ClientTab => CLIENT_TABS.find((tab) => tab === named) ?? OPENING_TAB;

const settingsTabOf = (named: string | undefined): SettingsTab =>
  SETTINGS_TABS.find((tab) => tab === named) ?? SETTINGS_TABS[0];

const technicianTabOf = (named: string | undefined): TechnicianTab =>
  TECHNICIAN_TABS.find((tab) => tab === named) ?? TECHNICIAN_TABS[0];

const isPlain = (page: Page): page is PlainPage => page !== "clients" && page !== "settings" && page !== "technicians";

/** The page a path names, or null for a path the console has no page at. */
export function knownRoute(asked: string): Route | null {
  const path = movedTo(asked) ?? asked;
  const client = CLIENT_PATH.exec(path);
  if (client !== null) return { page: "clients", clientId: client[1] ?? null, tab: clientTabOf(client[2]) };
  const setting = SETTINGS_PATH.exec(path);
  if (setting !== null) return { page: "settings", tab: settingsTabOf(setting[1]) };
  const technician = TECHNICIAN_PATH.exec(path);
  if (technician !== null) {
    return { page: "technicians", technicianId: technician[1] ?? null, tab: technicianTabOf(technician[2]) };
  }
  const section = SECTIONS.find((each) => each.path === path);
  if (section === undefined || !isPlain(section.page)) return null;
  return { page: section.page };
}

export const routeOf = (path: string): Route => knownRoute(path) ?? TASKS;

export const settingsPath = (tab: SettingsTab): string => (tab === "rules" ? "/settings" : `/settings/${tab}`);

/** A technician's page, on its opening tab or the one named. */
export const technicianPath = (technicianId: string, tab: TechnicianTab = TECHNICIAN_TABS[0]): string =>
  tab === TECHNICIAN_TABS[0] ? `/technicians/${technicianId}` : `/technicians/${technicianId}/${tab}`;

/** What a link to the dispatch board asks it to open on: the week from a day, and a search narrowing its rows. */
interface DispatchAsked {
  readonly from: string | null;
  readonly find: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The dispatch board opened on the week from `from`, showing the rows that answer to `find`. */
export function dispatchPath(asked: { readonly from?: string; readonly find?: string }): string {
  const query = new URLSearchParams();
  if (asked.from !== undefined) query.set("from", asked.from);
  if (asked.find !== undefined) query.set("find", asked.find);
  const search = query.toString();
  return search === "" ? "/dispatch" : `/dispatch?${search}`;
}

/** What the address's query asks the dispatch board for: "?from=2026-10-12&find=Imran". */
export function dispatchAsked(search: string): DispatchAsked {
  const query = new URLSearchParams(search);
  const from = query.get("from");
  return { from: from !== null && ISO_DATE.test(from) ? from : null, find: query.get("find") ?? "" };
}

/** The section a page belongs to. */
export function sectionOf(page: Page): Section {
  const section = SECTIONS.find((each) => each.page === page);
  if (section === undefined) throw new Error(`no section has the page ${page}`);
  return section;
}

/**
 * The calls that go ahead for the person signed in, as "GET /api/tasks" (GET /api/whoami's may_call); null until the
 * API has said, when every section is shown and the API still refuses what it must.
 */
export type MayCall = ReadonlySet<string> | null;

/** Whether the person may open a page: whether the call it opens with goes ahead for them. */
export const mayOpen = (mayCall: MayCall, page: Page): boolean =>
  mayCall === null || mayCall.has(sectionOf(page).reads);

/** Where the console opens: the first section in the navigation the person may open, Tasks for most. */
export function landingPath(mayCall: MayCall): SectionPath | null {
  const first = SECTIONS.find((section) => mayOpen(mayCall, section.page));
  return first === undefined ? null : first.path;
}

/**
 * The path to show in place of the one asked for: a moved page's new one, or where the console opens for a path it
 * has no page at, once the API has said what the person may open. Null to leave the path as it is.
 */
export function redirectOf(path: string, mayCall: MayCall): string | null {
  const moved = movedTo(path);
  if (moved !== null) return moved;
  if (knownRoute(path) !== null || mayCall === null) return null;
  return landingPath(mayCall);
}

/** Each section's name and each Settings tab's, from content.ts; typed here, so one left unnamed fails the build. */
export const SECTION_NAMES: Readonly<Record<Page, string>> = shell.sections;
export const SETTINGS_TAB_NAMES: Readonly<Record<SettingsTab, string>> = settings.tabs;
export const TECHNICIAN_TAB_NAMES: Readonly<Record<TechnicianTab, string>> = technicians.tabs;

/**
 * The browser tab's title: the tab within the section, if it has one, then the
 * section. Never a client's name, which would then sit in the browser's history.
 */
export function titleOf(route: Route): string {
  const section = SECTION_NAMES[route.page];
  if (route.page === "settings") return shell.documentTitle([SETTINGS_TAB_NAMES[route.tab], section]);
  if (route.page === "clients" && route.clientId !== null) {
    const tab = clients.tabs.find((each) => each.tab === route.tab);
    return shell.documentTitle(tab === undefined ? [section] : [tab.label, section]);
  }
  if (route.page === "technicians" && route.technicianId !== null) {
    return shell.documentTitle([TECHNICIAN_TAB_NAMES[route.tab], section]);
  }
  return shell.documentTitle([section]);
}

/**
 * What keys the page, so each one opens at its top and a new client or technician loads afresh. A page's tabs share
 * one key: moving between them must not read the record again.
 */
export function keyOf(route: Route): string {
  if (route.page === "clients") return `clients/${route.clientId ?? ""}`;
  if (route.page === "technicians") return `technicians/${route.technicianId ?? ""}`;
  return route.page;
}
