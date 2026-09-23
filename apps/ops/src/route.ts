// The console's pages, by path. Links change the path without a reload; the
// Worker answers every path with the console, so a page can be opened directly.
//
//   /referrals              the review queue (C1) over the referrers' figures (C2)
//   /waitlist               who is waiting, and marking a pincode live (C3)
//   /clients                finding one client by their mobile number
//   /clients/:id/photos     that client's photographs (B2), locked until the view is logged
//   /clients/:id/consents   what they have agreed to (B3)
//
// Anything else, "/" included, is the referrals page: the design opens on
// Dispatch, which waits for the FSM mirror (docs/decisions/0032-fsm-mirror.md).

import { useEffect, useState } from "react";

/** The tabs of the design's eight that a client's page carries. */
export type ClientTab = "photos" | "consents";

export type Route =
  | { readonly page: "referrals" }
  | { readonly page: "waitlist" }
  | { readonly page: "clients"; readonly clientId: string | null; readonly tab: ClientTab };

const REFERRALS: Route = { page: "referrals" };
const CLIENT_PATH = /^\/clients\/([0-9a-f-]{36})(?:\/(photos|consents))?$/;

export function routeOf(path: string): Route {
  if (path === "/waitlist") return { page: "waitlist" };
  if (path === "/clients") return { page: "clients", clientId: null, tab: "photos" };
  const client = CLIENT_PATH.exec(path);
  if (client !== null) {
    return { page: "clients", clientId: client[1] ?? null, tab: client[2] === "consents" ? "consents" : "photos" };
  }
  return REFERRALS;
}

/**
 * What keys the page, so each one opens at its top and a new client loads
 * afresh. A client's two tabs share one key: moving between them must not read
 * the record again.
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
