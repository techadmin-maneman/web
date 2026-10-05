// A client search, from any page, kept in the history entry rather than the
// address: Back to the Clients page finds its results again, and a number never
// reaches an address bar, a referrer or a log.
//
// The clients opened this session, the latest first, are kept for the Clients
// page to offer again: ids and names alone, in sessionStorage, so they go when
// the tab closes. Signing out clears them too, for whoever signs in next.

import type { ClientsFound } from "../api.ts";

/** The words searched for, and what they found; null until the search has answered. */
export interface KeptSearch {
  readonly text: string;
  readonly found: ClientsFound | null;
}

interface RecentClient {
  readonly id: string;
  readonly name: string;
}

const SEARCH = "clientSearch";
const RECENT = "ops.recent-clients";
const RECENT_KEPT = 5;

/** The search this history entry holds, if it holds one. */
export function keptSearch(): KeptSearch | null {
  const state: unknown = window.history.state;
  if (typeof state !== "object" || state === null || !(SEARCH in state)) return null;
  const kept: unknown = (state as Record<string, unknown>)[SEARCH];
  if (typeof kept !== "object" || kept === null || !("text" in kept) || typeof kept.text !== "string") return null;
  const found = "found" in kept && typeof kept.found === "object" ? (kept.found as ClientsFound | null) : null;
  return { text: kept.text, found };
}

/** Keeps what a search found in this history entry, beside anything else the entry holds. */
export function keepSearch(search: KeptSearch): void {
  const state: unknown = window.history.state;
  const others = typeof state === "object" && state !== null ? state : {};
  window.history.replaceState({ ...others, [SEARCH]: search }, "");
}

/** Opens the Clients page on a search typed into the header of another page. */
export function findFrom(text: string): void {
  window.history.pushState({ [SEARCH]: { text, found: null } }, "", "/clients");
  window.dispatchEvent(new PopStateEvent("popstate"));
}

const isRecent = (each: unknown): each is RecentClient =>
  typeof each === "object" &&
  each !== null &&
  "id" in each &&
  typeof each.id === "string" &&
  "name" in each &&
  typeof each.name === "string";

/** The clients opened this session, the latest first. Empty where the browser keeps nothing for a page. */
export function recentClients(): RecentClient[] {
  try {
    const kept: unknown = JSON.parse(sessionStorage.getItem(RECENT) ?? "[]");
    return Array.isArray(kept) ? kept.filter(isRecent) : [];
  } catch {
    return [];
  }
}

export function rememberClient(client: RecentClient): void {
  const others = recentClients().filter((each) => each.id !== client.id);
  try {
    sessionStorage.setItem(RECENT, JSON.stringify([client, ...others].slice(0, RECENT_KEPT)));
  } catch {
    // A browser that keeps nothing for a page simply offers no recent clients.
  }
}

export function forgetClients(): void {
  try {
    sessionStorage.removeItem(RECENT);
  } catch {
    // Nothing was kept to forget.
  }
}
