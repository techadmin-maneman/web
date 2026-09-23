// The app's pages, by path. Links change the path without a reload; the Worker
// answers every path with the app, so a page can be opened directly.
//
//   /                    today's jobs, tomorrow collapsed (board A1)
//   /waiting             what has not reached us: the photo sets and the queued writes (board A2)
//   /jobs/:id            one job's card (board A3)
//   /jobs/:id/photos     step 1, the five before angles (board B1)

import { useEffect, useState } from "react";

export type Route =
  | { readonly page: "today" }
  | { readonly page: "waiting" }
  | { readonly page: "job"; readonly id: string }
  | { readonly page: "capture"; readonly id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TODAY: Route = { page: "today" };

export function routeOf(path: string): Route {
  const [first, second, third, ...rest] = path.split("/").filter((part) => part !== "");
  if (first === undefined || rest.length > 0) return TODAY;
  if (second === undefined) return first === "waiting" ? { page: "waiting" } : TODAY;
  if (first !== "jobs" || !UUID.test(second)) return TODAY;
  if (third === undefined) return { page: "job", id: second };
  return third === "photos" ? { page: "capture", id: second } : TODAY;
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
