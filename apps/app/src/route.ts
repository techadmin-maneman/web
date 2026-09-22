// The app's pages, by path. Links change the path without a reload; the
// Worker answers every path with the app, so a page can be opened directly.

import { useEffect, useState } from "react";

export const PAGES = ["/", "/visits", "/photos", "/payments", "/refer", "/profile"] as const;
export type Page = (typeof PAGES)[number];

const pageOf = (path: string): Page => PAGES.find((page) => page === path) ?? "/";

export function usePage(): Page {
  const [page, setPage] = useState<Page>(() => pageOf(window.location.pathname));
  useEffect(() => {
    const onChange = () => {
      setPage(pageOf(window.location.pathname));
    };
    window.addEventListener("popstate", onChange);
    return () => {
      window.removeEventListener("popstate", onChange);
    };
  }, []);
  return page;
}

export function go(page: Page): void {
  if (window.location.pathname === page) return;
  window.history.pushState(null, "", page);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
