// The console's pages, by path. Links change the path without a reload, and the Worker answers every path with the
// console, so a page can be opened directly. SECTIONS is the one list of the pages of work, NAV the navigation's
// entries over them, and SETTINGS_PAGES the one list of Settings' pages: the navigation draws them, routeOf reads
// them, and each page is titled from them.

import { clients, settingsGroupNames, settingsPageNames, shell, technicians } from "./content.ts";
import { RULE_GROUPS, OTHER_GROUP, type RuleGroupId } from "./settings/rule-groups.ts";
import type { OpsSettingName } from "@rules/policy/ops-settings.ts";

/** The router the apps share (packages/ui/router.tsx): the console's pages take it from here. */
export { followsHere, go, redirect, usePath } from "@maneman/ui/router";

interface SectionShape {
  readonly page: string;
  readonly path: string;
  /** The call its page opens with, as src/policy/console-routes.ts names it: shown to those whose calls to it go ahead. */
  readonly reads: string;
}

/** Every page of work, in the navigation's order, Today first. */
export const SECTIONS = [
  { page: "today", path: "/today", reads: "GET /api/tasks" },
  { page: "tasks", path: "/tasks", reads: "GET /api/tasks" },
  { page: "dispatch", path: "/dispatch", reads: "GET /api/dispatch" },
  { page: "clients", path: "/clients", reads: "POST /api/clients/find" },
  { page: "messages", path: "/messages", reads: "GET /api/conversations" },
  { page: "technicians", path: "/technicians", reads: "GET /api/technicians" },
  { page: "stock", path: "/stock", reads: "GET /api/stock" },
  { page: "counts", path: "/counts", reads: "GET /api/count-tasks" },
  { page: "purchasing", path: "/purchasing", reads: "GET /api/purchase-orders" },
  { page: "supply-plan", path: "/supply-plan", reads: "GET /api/supply-plan" },
  { page: "quality", path: "/quality", reads: "GET /api/recalls" },
  { page: "usage", path: "/usage", reads: "GET /api/stock/usage" },
  { page: "items", path: "/items", reads: "GET /api/consumables" },
  { page: "suppliers", path: "/suppliers", reads: "GET /api/suppliers" },
  { page: "grievances", path: "/grievances", reads: "GET /api/grievances" },
  { page: "number-changes", path: "/number-changes", reads: "GET /api/number-changes" },
  { page: "deletion-requests", path: "/deletion-requests", reads: "GET /api/deletion-requests" },
  { page: "payments", path: "/payments", reads: "GET /api/no-shows" },
  { page: "technician-pay", path: "/technician-pay", reads: "GET /api/technician-pay" },
  { page: "partner-commission", path: "/partner-commission", reads: "GET /api/partner-statements" },
  { page: "referrals", path: "/referrals", reads: "GET /api/referrals/held" },
  { page: "waitlist", path: "/waitlist", reads: "GET /api/waitlist" },
  { page: "funnel", path: "/funnel", reads: "GET /api/growth/funnel" },
  { page: "spend", path: "/spend", reads: "GET /api/spend" },
  { page: "care-numbers", path: "/care-numbers", reads: "GET /api/care-numbers" },
  { page: "activity", path: "/activity", reads: "GET /api/activity" },
] as const satisfies readonly SectionShape[];

export type Section = (typeof SECTIONS)[number];
export type Page = Section["page"];
export type SectionPath = Section["path"];

/**
 * The navigation's entries, each over the pages of one job: an entry of several opens on the first the person may
 * open, and heads each of its pages with the others as tabs.
 */
export const NAV = [
  { entry: "today", pages: ["today"] },
  { entry: "tasks", pages: ["tasks"] },
  { entry: "dispatch", pages: ["dispatch"] },
  { entry: "clients", pages: ["clients"] },
  { entry: "messages", pages: ["messages"] },
  { entry: "technicians", pages: ["technicians"] },
  {
    entry: "inventory",
    pages: ["stock", "counts", "purchasing", "supply-plan", "quality", "usage", "items", "suppliers"],
  },
  { entry: "requests", pages: ["grievances", "number-changes", "deletion-requests"] },
  { entry: "money", pages: ["payments", "technician-pay", "partner-commission"] },
  { entry: "growth", pages: ["funnel", "referrals", "waitlist", "spend"] },
  { entry: "reports", pages: ["care-numbers", "activity"] },
] as const satisfies readonly { entry: string; pages: readonly Page[] }[];

export type NavEntry = (typeof NAV)[number];
export type NavKey = NavEntry["entry"];

/** The navigation's entry a page is under. */
export function navOf(page: Page): NavEntry {
  const entry = NAV.find((each) => (each.pages as readonly Page[]).includes(page));
  if (entry === undefined) throw new Error(`no entry holds the page ${page}`);
  return entry;
}

/**
 * Settings' pages, by group, each with the call it opens with. A page of policies draws the rule groups it names
 * (./settings/rule-groups.ts); the rest are screens of their own.
 */
export const SETTINGS_PAGES = [
  { tab: "cities", group: "business", reads: "GET /api/cities" },
  { tab: "areas", group: "business", reads: "GET /api/service-area" },
  { tab: "targets", group: "business", reads: "GET /api/targets" },
  { tab: "window-times", group: "scheduling", reads: "GET /api/slot-times" },
  { tab: "closed-days", group: "scheduling", reads: "GET /api/blackouts" },
  { tab: "booking", group: "scheduling", reads: "GET /api/settings", rules: ["booking"] },
  { tab: "moves", group: "visits", reads: "GET /api/settings", rules: ["moves"] },
  { tab: "field", group: "visits", reads: "GET /api/settings", rules: ["field"] },
  { tab: "reminders", group: "visits", reads: "GET /api/settings", rules: ["reminders"] },
  { tab: "job-sheet", group: "visits", reads: "GET /api/job-sheet" },
  { tab: "packages", group: "prices", reads: "GET /api/packages" },
  { tab: "services", group: "prices", reads: "GET /api/services" },
  { tab: "discount-codes", group: "prices", reads: "GET /api/discount-codes" },
  { tab: "referrals", group: "growth", reads: "GET /api/settings", rules: ["referrals"] },
  { tab: "partners", group: "growth", reads: "GET /api/referral-channels" },
  { tab: "try-on", group: "growth", reads: "GET /api/settings", rules: ["tryon"] },
  { tab: "words", group: "growth", reads: "GET /api/words" },
  { tab: "care-team", group: "care", reads: "GET /api/care-team" },
  { tab: "care-hours", group: "care", reads: "GET /api/settings", rules: ["care"] },
  { tab: "remedies", group: "care", reads: "GET /api/remedies" },
  { tab: "quick-replies", group: "care", reads: "GET /api/quick-replies" },
  { tab: "stock", group: "inventory", reads: "GET /api/settings", rules: ["stock"] },
  { tab: "purchasing", group: "inventory", reads: "GET /api/settings", rules: ["purchasing"] },
  { tab: "supply-plan", group: "inventory", reads: "GET /api/settings", rules: ["supply_plan"] },
  { tab: "staff", group: "team", reads: "GET /api/staff" },
  { tab: "pay-grades", group: "team", reads: "GET /api/technician-pay" },
  { tab: "console", group: "system", reads: "GET /api/settings", rules: ["console", OTHER_GROUP] },
  { tab: "limits", group: "system", reads: "GET /api/settings", rules: ["limits"] },
  { tab: "reports", group: "system", reads: "GET /api/settings", rules: ["reports"] },
] as const satisfies readonly {
  tab: string;
  group: string;
  reads: string;
  rules?: readonly RuleGroupId[];
}[];

export type SettingsPage = (typeof SETTINGS_PAGES)[number];
export type SettingsTab = SettingsPage["tab"];
/** A page of policies, which draws its rule groups. */
type RulesTab = Extract<SettingsPage, { rules: unknown }>["tab"];
/** A page that is a screen of its own. */
export type ScreenTab = Exclude<SettingsTab, RulesTab>;
export type SettingsGroup = SettingsPage["group"];

/** Settings' groups, in their menu's order. */
export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  ...new Set(SETTINGS_PAGES.map((each) => each.group)),
] as SettingsGroup[];

export const settingsPageOf = (tab: SettingsTab): SettingsPage => {
  const page = SETTINGS_PAGES.find((each) => each.tab === tab);
  if (page === undefined) throw new Error(`Settings has no page ${tab}`);
  return page;
};

/** A section that is one page, with nothing beneath it. */
export type PlainPage = Exclude<Page, "clients" | "technicians">;

/**
 * The tabs of the design's eight that a client's page carries, in its order, after the Overview, which the board draws
 * no tab for: the page opens on it.
 */
export const CLIENT_TABS = ["history", "visits", "pieces", "payments", "referrals", "consents", "photos"] as const;
export type ClientTab = (typeof CLIENT_TABS)[number];
const OPENING_TAB: ClientTab = "history";

/** A technician's page, a tab at a time, in its order. It opens on their week. */
export const TECHNICIAN_TABS = ["week", "hours", "leave", "phones", "kit"] as const;
export type TechnicianTab = (typeof TECHNICIAN_TABS)[number];

/**
 * A page, as its path names it. Three sections have pages beneath them:
 *
 *   /clients/:id/:tab       a client's page, a tab at a time
 *   /technicians/:id/:tab   a technician's page: their week, hours, leave, phones and kit
 *   /settings/:tab          one of Settings' pages
 *
 * Anything else, "/" included, is where the console opens: Today, or the first page the person may open.
 */
export type Route =
  | { readonly page: PlainPage }
  | { readonly page: "settings"; readonly tab: SettingsTab }
  | { readonly page: "clients"; readonly clientId: string | null; readonly tab: ClientTab }
  | { readonly page: "technicians"; readonly technicianId: string | null; readonly tab: TechnicianTab };

const TODAY: Route = { page: "today" };
/** A path's tab, one of `tabs`, as a pattern's group; the tabs are words, so none needs escaping. */
const oneOf = (tabs: readonly string[]): string => `(${tabs.join("|")})`;
const ID = "([0-9a-f-]{36})";
const CLIENT_PATH = new RegExp(`^/clients(?:/${ID}(?:/${oneOf(CLIENT_TABS)})?)?$`);
const SETTINGS_PATH = new RegExp(`^/settings(?:/${oneOf(SETTINGS_PAGES.map((each) => each.tab))})?$`);
const TECHNICIAN_PATH = new RegExp(`^/technicians(?:/${ID}(?:/${oneOf(TECHNICIAN_TABS)})?)?$`);

/**
 * Pages that moved, so a link or bookmark to one still lands: what was set up in each department, now in Settings; the
 * waitlist, once a tab of Areas; and the no-shows, now under Charges.
 */
const MOVED: Readonly<Record<string, string>> = {
  "/prices": "/settings/services",
  "/settings/prices": "/settings/services",
  "/settings/hair-systems": "/settings/packages",
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
  "/settings/suppliers": "/suppliers",
};

/** Where a page that has moved is now; null for a path that has not moved. */
function movedTo(path: string): string | null {
  if (!Object.hasOwn(MOVED, path)) return null;
  return MOVED[path] ?? null;
}

/** The tab a client's path names; Visits without one. */
const clientTabOf = (named: string | undefined): ClientTab => CLIENT_TABS.find((tab) => tab === named) ?? OPENING_TAB;

const settingsTabOf = (named: string | undefined): SettingsTab =>
  SETTINGS_PAGES.find((each) => each.tab === named)?.tab ?? SETTINGS_PAGES[0].tab;

const technicianTabOf = (named: string | undefined): TechnicianTab =>
  TECHNICIAN_TABS.find((tab) => tab === named) ?? TECHNICIAN_TABS[0];

const WITH_TABS: readonly Page[] = ["clients", "technicians"];
const isPlain = (page: Page): page is PlainPage => !WITH_TABS.includes(page);

/** The page a path names, or null for a path the console has no page at. */
function knownRoute(asked: string): Route | null {
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

export const routeOf = (path: string): Route => knownRoute(path) ?? TODAY;

export const settingsPath = (tab: SettingsTab): string => `/settings/${tab}`;

/** Settings' page that holds a rule. */
export function rulePageOf(name: string): SettingsPage {
  const group = RULE_GROUPS.find((each) => (each.rules as readonly string[]).includes(name))?.id ?? OTHER_GROUP;
  const page = SETTINGS_PAGES.find((each) => "rules" in each && (each.rules as readonly string[]).includes(group));
  return page ?? settingsPageOf("console");
}

/** Settings' page that holds a rule, and the rule on it, which the page scrolls to once it has loaded. */
export const rulePath = (name: OpsSettingName): string => `${settingsPath(rulePageOf(name).tab)}#${name}`;

/** A client's page on the tab named, so a link lands on what it is about. */
export const clientPath = (clientId: string, tab: ClientTab): string => `/clients/${clientId}/${tab}`;

/** A technician's page, on its opening tab or the one named. */
export const technicianPath = (technicianId: string, tab: TechnicianTab = TECHNICIAN_TABS[0]): string =>
  tab === TECHNICIAN_TABS[0] ? `/technicians/${technicianId}` : `/technicians/${technicianId}/${tab}`;

/**
 * What a link to the dispatch board asks it to open on: the week from a day, a city, a search narrowing its rows,
 * and a visit whose drawer opens. Null, or an empty search, for this week, every city, every row and no drawer.
 */
interface DispatchAsked {
  readonly from: string | null;
  readonly city: string | null;
  readonly find: string;
  readonly visit: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The dispatch board opened as asked; whatever is left out is the board's own first view of it. */
export function dispatchPath(asked: Partial<DispatchAsked>): string {
  const query = new URLSearchParams();
  const parts = [
    ["from", asked.from],
    ["city", asked.city],
    ["find", asked.find],
    ["visit", asked.visit],
  ] as const;
  for (const [name, value] of parts) {
    if (value !== undefined && value !== null && value !== "") query.set(name, value);
  }
  const search = query.toString();
  return search === "" ? "/dispatch" : `/dispatch?${search}`;
}

/**
 * Activity narrowed as asked, by the API's own names for each filter: "/activity" for the whole log,
 * "/activity?person=…" for one client's whole record.
 */
export function activityPath(asked: Readonly<Record<string, string | undefined>>): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(asked)) {
    if (value !== undefined && value !== "") query.set(name, value);
  }
  const search = query.toString();
  return search === "" ? "/activity" : `/activity?${search}`;
}

/** The query's value, where it is there and has the form asked for. */
function valueOf(query: URLSearchParams, name: string, form: RegExp): string | null {
  const value = query.get(name);
  return value !== null && form.test(value) ? value : null;
}

/** What the address's query asks the dispatch board for: "?from=2026-10-12&city=Gurgaon&find=Imran&visit=…". */
export function dispatchAsked(search: string): DispatchAsked {
  const query = new URLSearchParams(search);
  const city = query.get("city")?.trim() ?? "";
  return {
    from: valueOf(query, "from", ISO_DATE),
    city: city === "" ? null : city,
    find: query.get("find") ?? "",
    visit: valueOf(query, "visit", UUID),
  };
}

/** The section a page belongs to. */
export function sectionOf(page: Page): Section {
  const section = SECTIONS.find((each) => each.page === page);
  if (section === undefined) throw new Error(`no section has the page ${page}`);
  return section;
}

/**
 * The calls that go ahead for the person signed in, as "GET /api/tasks" (GET /api/whoami's may_call); null until the
 * API has said, when every page is shown and the API still refuses what it must.
 */
export type MayCall = ReadonlySet<string> | null;

/** Whether the person may open a page of work: whether the call it opens with goes ahead for them. */
export const mayOpen = (mayCall: MayCall, page: Page): boolean =>
  mayCall === null || mayCall.has(sectionOf(page).reads);

/** Whether the person may open one of Settings' pages. */
export const mayOpenSetting = (mayCall: MayCall, tab: SettingsTab): boolean =>
  mayCall === null || mayCall.has(settingsPageOf(tab).reads);

/** The first of Settings' pages the person may open; null for one who may open none. */
export function firstSetting(mayCall: MayCall): SettingsTab | null {
  return SETTINGS_PAGES.find((each) => mayOpenSetting(mayCall, each.tab))?.tab ?? null;
}

/** Whether the person may open any of a route's pages. */
export function mayOpenRoute(mayCall: MayCall, route: Route): boolean {
  if (route.page === "settings") return mayOpenSetting(mayCall, route.tab);
  return mayOpen(mayCall, route.page);
}

/** Whether a link leads to a page the person may open, its query and anchor aside. */
export const mayFollow = (mayCall: MayCall, to: string): boolean =>
  mayOpenRoute(mayCall, routeOf(to.split(/[?#]/)[0] ?? to));

/** Where the console opens: the first page in the navigation the person may open, Today for most. */
export function landingPath(mayCall: MayCall): SectionPath | null {
  const first = SECTIONS.find((section) => mayOpen(mayCall, section.page));
  return first === undefined ? null : first.path;
}

/** The rule a hash names, "#no_show_wait_min", where it is one of the rules a page of Settings draws. */
function ruleOf(hash: string): OpsSettingName | null {
  const name = hash.replace(/^#/, "");
  return RULE_GROUPS.some((group) => (group.rules as readonly string[]).includes(name))
    ? (name as OpsSettingName)
    : null;
}

/**
 * The path to show in place of the one asked for: a moved page's new one; Settings' page holding a rule an old link
 * names; Settings' first page the person may open for Settings itself; or where the console opens for a path it has no
 * page at, once the API has said what the person may open. Null to leave the path as it is.
 */
export function redirectOf(path: string, mayCall: MayCall, hash = ""): string | null {
  const moved = movedTo(path);
  if (moved !== null) return moved;
  if (path === "/settings") {
    const rule = ruleOf(hash);
    if (rule !== null) return rulePath(rule);
    if (mayCall === null) return null;
    const first = firstSetting(mayCall);
    return first === null ? landingPath(mayCall) : settingsPath(first);
  }
  if (knownRoute(path) !== null || mayCall === null) return null;
  return landingPath(mayCall);
}

/** Each page's name, from content.ts; typed here, so one left unnamed fails the build. */
export const SECTION_NAMES: Readonly<Record<Page, string>> = shell.sections;
export const NAV_NAMES: Readonly<Record<NavKey, string>> = shell.nav;
export const SETTINGS_PAGE_NAMES: Readonly<Record<SettingsTab, string>> = settingsPageNames;
export const SETTINGS_GROUP_NAMES: Readonly<Record<SettingsGroup, string>> = settingsGroupNames;
export const TECHNICIAN_TAB_NAMES: Readonly<Record<TechnicianTab, string>> = technicians.tabs;

/**
 * The browser tab's title: the tab within the section, if it has one, then the
 * section. Never a client's name, which would then sit in the browser's history.
 */
export function titleOf(route: Route): string {
  if (route.page === "settings") {
    return shell.documentTitle([SETTINGS_PAGE_NAMES[route.tab], shell.settings]);
  }
  const section = SECTION_NAMES[route.page];
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
  if (route.page === "settings") return `settings/${route.tab}`;
  return route.page;
}
