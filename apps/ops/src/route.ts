// The console's pages, by path. Links change the path without a reload; the
// Worker answers every path with the console, so a page can be opened directly.
//
//   /dispatch               the week's board (A1), its drawer (A3) and its move (A2)
//   /referrals              the review queue (C1) over the referrers' figures (C2)
//   /waitlist               who is waiting, and marking a pincode live (C3)
//   /clients                finding one client by their mobile number
//   /clients/:id/pieces     the pieces they have been fitted with (B1)
//   /clients/:id/photos     that client's photographs (B2), locked until the view is logged
//   /clients/:id/consents   what they have agreed to (B3)
//   /clients/:id/history    how often they have been served, and what they have bought
//   /no-shows               the no-show cases and their evidence (D1's queue)
//   /tasks                  what ops still have to do, by group (D2)
//   /technicians            who works, and the phones they work from (D3)
//   /grievances             the concerns clients have raised, answered here
//   /deletion-requests      the accounts clients have asked us to erase
//   /number-changes         the numbers clients are moving to, confirmed here
//
// The last three are drawn on no board (docs/fidelity-method.md). Anything
// else, "/" included, is the dispatch board, which is what the design opens on.

import { useEffect, useState } from "react";

/**
 * The tabs of the design's eight that a client's page carries, in its order,
 * and History last: the board draws no such tab, so it stands after the three
 * it does draw (docs/fidelity-method.md).
 */
export const CLIENT_TABS = ["pieces", "consents", "photos", "history"] as const;
export type ClientTab = (typeof CLIENT_TABS)[number];

export type Route =
  | { readonly page: "dispatch" }
  | { readonly page: "referrals" }
  | { readonly page: "waitlist" }
  | { readonly page: "no-shows" }
  | { readonly page: "tasks" }
  | { readonly page: "technicians" }
  | { readonly page: "grievances" }
  | { readonly page: "deletion-requests" }
  | { readonly page: "number-changes" }
  | { readonly page: "clients"; readonly clientId: string | null; readonly tab: ClientTab };

const DISPATCH: Route = { page: "dispatch" };
const CLIENT_PATH = /^\/clients\/([0-9a-f-]{36})(?:\/(pieces|photos|consents|history))?$/;

/** The tab a client's path names; Pieces without one, as the board draws the page. */
const tabOf = (named: string | undefined): ClientTab => CLIENT_TABS.find((tab) => tab === named) ?? CLIENT_TABS[0];

export function routeOf(path: string): Route {
  if (path === "/referrals") return { page: "referrals" };
  if (path === "/waitlist") return { page: "waitlist" };
  if (path === "/no-shows") return { page: "no-shows" };
  if (path === "/tasks") return { page: "tasks" };
  if (path === "/technicians") return { page: "technicians" };
  if (path === "/grievances") return { page: "grievances" };
  if (path === "/deletion-requests") return { page: "deletion-requests" };
  if (path === "/number-changes") return { page: "number-changes" };
  if (path === "/clients") return { page: "clients", clientId: null, tab: tabOf(undefined) };
  const client = CLIENT_PATH.exec(path);
  if (client !== null) return { page: "clients", clientId: client[1] ?? null, tab: tabOf(client[2]) };
  return DISPATCH;
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
