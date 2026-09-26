// The console's pages, by path. Links change the path without a reload; the
// Worker answers every path with the console, so a page can be opened directly.
//
// SECTIONS below is the one list of them: the navigation draws it, routeOf reads
// it, and each page is titled from it. Two sections have pages beneath them:
//
//   /clients/:id/:tab       a client's page, a tab at a time (B1 to B3, and the tabs no board draws)
//   /settings/:tab          the rules, the price book and the service area (ADR 0061)
//
// Anything else, "/" included, is the dispatch board, which is what the design opens on.

import { useEffect, useState } from "react";
import { clients, settings, shell } from "./content.ts";

/**
 * The console's sections, in the navigation's order: the design's eight, with
 * No-shows where it draws Payments, and the three a client's rights over their
 * data put in front of ops before Settings (docs/fidelity-method.md).
 */
export const SECTIONS = [
  { page: "dispatch", path: "/dispatch" },
  { page: "clients", path: "/clients" },
  { page: "no-shows", path: "/no-shows" },
  { page: "referrals", path: "/referrals" },
  { page: "waitlist", path: "/waitlist" },
  { page: "tasks", path: "/tasks" },
  { page: "technicians", path: "/technicians" },
  { page: "grievances", path: "/grievances" },
  { page: "deletion-requests", path: "/deletion-requests" },
  { page: "number-changes", path: "/number-changes" },
  { page: "settings", path: "/settings" },
] as const;

export type Page = (typeof SECTIONS)[number]["page"];
export type SectionPath = (typeof SECTIONS)[number]["path"];

/** A section that is one page, with nothing beneath it. */
export type PlainPage = Exclude<Page, "clients" | "settings">;

/**
 * The tabs of the design's eight that a client's page carries, in its order,
 * and History last: the board draws no such tab, so it stands after the ones
 * it does draw (docs/fidelity-method.md). The page opens on Pieces, as the
 * board draws it.
 */
export const CLIENT_TABS = ["visits", "pieces", "payments", "consents", "photos", "history"] as const;
export type ClientTab = (typeof CLIENT_TABS)[number];
const OPENING_TAB: ClientTab = "pieces";

/** What Settings holds, in the order the section lists it. Rules has the section's own path. */
export const SETTINGS_TABS = ["rules", "prices", "area"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export type Route =
  | { readonly page: PlainPage }
  | { readonly page: "settings"; readonly tab: SettingsTab }
  | { readonly page: "clients"; readonly clientId: string | null; readonly tab: ClientTab };

const DISPATCH: Route = { page: "dispatch" };
const CLIENT_PATH = /^\/clients(?:\/([0-9a-f-]{36})(?:\/(visits|pieces|payments|photos|consents|history))?)?$/;
const SETTINGS_PATH = /^\/settings(?:\/(prices|area))?$/;

/** The tab a client's path names; Pieces without one, as the board draws the page. */
const clientTabOf = (named: string | undefined): ClientTab => CLIENT_TABS.find((tab) => tab === named) ?? OPENING_TAB;

const settingsTabOf = (named: string | undefined): SettingsTab =>
  SETTINGS_TABS.find((tab) => tab === named) ?? SETTINGS_TABS[0];

const isPlain = (page: Page): page is PlainPage => page !== "clients" && page !== "settings";

export function routeOf(path: string): Route {
  const client = CLIENT_PATH.exec(path);
  if (client !== null) return { page: "clients", clientId: client[1] ?? null, tab: clientTabOf(client[2]) };
  const setting = SETTINGS_PATH.exec(path);
  if (setting !== null) return { page: "settings", tab: settingsTabOf(setting[1]) };
  const section = SECTIONS.find((each) => each.path === path);
  if (section === undefined || !isPlain(section.page)) return DISPATCH;
  return { page: section.page };
}

export const settingsPath = (tab: SettingsTab): string => (tab === "rules" ? "/settings" : `/settings/${tab}`);

/** Each section's name and each Settings tab's, from content.ts; typed here, so one left unnamed fails the build. */
export const SECTION_NAMES: Readonly<Record<Page, string>> = shell.sections;
export const SETTINGS_TAB_NAMES: Readonly<Record<SettingsTab, string>> = settings.tabs;

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
  return shell.documentTitle([section]);
}

/**
 * What keys the page, so each one opens at its top and a new client loads
 * afresh. A client's tabs share one key: moving between them must not read the
 * record again.
 */
export function keyOf(route: Route): string {
  return route.page === "clients" ? `clients/${route.clientId ?? ""}` : route.page;
}

/** The path shown, which keys the page so each one opens at its top. */
export function usePath(): string {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const onChange = () => {
      setPath(window.location.pathname);
    };
    window.addEventListener("popstate", onChange);
    return () => {
      window.removeEventListener("popstate", onChange);
    };
  }, []);
  return path;
}

export function go(path: string): void {
  if (window.location.pathname === path) return;
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** The parts of a click that say where the person wants the link opened. */
export interface Click {
  readonly button: number;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

/**
 * Whether a click on a console link should change the page in place. A click
 * with Ctrl, Cmd, Shift or Alt held, or with any button but the main one, asks
 * for a new tab, a new window or a download, and is left to the browser.
 */
export const followsHere = (click: Click): boolean =>
  click.button === 0 && !click.metaKey && !click.ctrlKey && !click.shiftKey && !click.altKey;
