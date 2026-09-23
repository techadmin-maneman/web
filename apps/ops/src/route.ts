// The console's pages, by path. Links change the path without a reload; the
// Worker answers every path with the console, so a page can be opened directly.
//
//   /referrals   the review queue (C1) over the referrers' figures (C2)
//   /waitlist    who is waiting, and marking a pincode live (C3)
//
// Anything else, "/" included, is the referrals page: the design opens on
// Dispatch, which waits for the FSM mirror (docs/decisions/0032-fsm-mirror.md).

import { useEffect, useState } from "react";

export type Route = { readonly page: "referrals" } | { readonly page: "waitlist" };

const REFERRALS: Route = { page: "referrals" };

export function routeOf(path: string): Route {
  return path === "/waitlist" ? { page: "waitlist" } : REFERRALS;
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
