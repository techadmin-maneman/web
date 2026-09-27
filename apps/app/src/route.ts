// The app's pages, by path. Links change the path without a reload; the
// Worker answers every path with the app, so a page can be opened directly.
//
//   /                  Home
//   /visits            upcoming and past (C1); /visits/:id, one past visit (C9)
//   /photos            the timeline (D1); /photos/compare (D2)
//   /payments          payments and refunds (E1); /payments/:id, one entry (E2)
//   /refer             the invite (F1); /refer/fitted, who has been fitted (F5 and F6)
//   /profile
//   /replacement       what a replacement involves, which Home's prompt opens (no board; ADR 0086)

/** The router the apps share (packages/ui/router.tsx), so a page takes its routes and its way between them from here. */
export { go, usePath } from "@maneman/ui/router";

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
  | { readonly page: "profile" }
  | { readonly page: "replacement" };

export const TABS = ["/", "/visits", "/photos", "/payments", "/refer"] as const;
export type Tab = (typeof TABS)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HOME: Route = { page: "home" };
// A Map, not an object: a path such as /constructor must not find what every object carries.
const TOP: ReadonlyMap<string, Route> = new Map([
  ["visits", { page: "visits" }],
  ["photos", { page: "photos" }],
  ["payments", { page: "payments" }],
  ["refer", { page: "refer" }],
  ["profile", { page: "profile" }],
  ["replacement", { page: "replacement" }],
]);

export function routeOf(path: string): Route {
  const [first, second, ...rest] = path.split("/").filter((part) => part !== "");
  if (first === undefined || rest.length > 0) return HOME;
  if (second === undefined) return TOP.get(first) ?? HOME;
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
    case "replacement":
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
