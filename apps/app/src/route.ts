// The app's pages, by path. Links change the path without a reload; the
// Worker answers every path with the app, so a page can be opened directly.
//
//   /                  Home
//   /visits            upcoming and past (C1); /visits/:id, one past visit (C9)
//   /photos            the timeline (D1); /photos/compare (D2)
//   /payments          payments and refunds (E1); /payments/:id, one entry (E2)
//   /refer             the invite (F1); /refer/fitted, who has been fitted (F5 and F6)
//   /profile

import { useEffect, useState } from "react";

export type Route =
  | { readonly page: "home" }
  | { readonly page: "visits" }
  | { readonly page: "visit"; readonly id: string }
  | { readonly page: "photos" }
  | { readonly page: "compare" }
  | { readonly page: "payments" }
  | { readonly page: "entry"; readonly id: string }
  | { readonly page: "refer" }
  | { readonly page: "fitted" }
  | { readonly page: "profile" };

export const TABS = ["/", "/visits", "/photos", "/payments", "/refer"] as const;
export type Tab = (typeof TABS)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HOME: Route = { page: "home" };
const TOP: Readonly<Record<string, Route>> = {
  visits: { page: "visits" },
  photos: { page: "photos" },
  payments: { page: "payments" },
  refer: { page: "refer" },
  profile: { page: "profile" },
};

export function routeOf(path: string): Route {
  const [first, second, ...rest] = path.split("/").filter((part) => part !== "");
  if (first === undefined || rest.length > 0) return HOME;
  if (second === undefined) return TOP[first] ?? HOME;
  if (first === "visits" && UUID.test(second)) return { page: "visit", id: second };
  if (first === "payments" && UUID.test(second)) return { page: "entry", id: second };
  if (first === "photos" && second === "compare") return { page: "compare" };
  if (first === "refer" && second === "fitted") return { page: "fitted" };
  return HOME;
}

/** The tab a page sits under; the profile sits under none. */
export function tabOf(route: Route): Tab | null {
  switch (route.page) {
    case "home":
      return "/";
    case "visits":
    case "visit":
      return "/visits";
    case "photos":
    case "compare":
      return "/photos";
    case "payments":
    case "entry":
      return "/payments";
    case "refer":
    case "fitted":
      return "/refer";
    case "profile":
      return null;
  }
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
