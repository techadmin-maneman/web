// The app's pages, by path (docs/decisions/0252-client-app-redesign.md). Links change the path without a reload; the
// Worker answers every path with the app, so a page can be opened directly.
//
//   /                          Home
//   /visits                    upcoming, past and issues; /visits/:id, one visit; /visits/issues/:id, one issue;
//                              /visits/issues/new, raising one
//   /photos                    the timeline and before and after
//   /rewards                   free service visits and the invite; /rewards/invited, who has been invited
//   /profile                   the profile; its pages /profile/payments (and /:id), /address, /privacy, /account
//   /alerts                    the alerts inbox, under the bell
//   /hair-system               the hair system worn, and every one before it
//   /hair-systems              the four hair systems compared
//
// The paths the five tabs had before keep working, so a link in a message already sent still opens: each is redirected
// to its new place (`movedTo`).

/** The router the apps share (packages/ui/router.tsx), so a page takes its routes and its way between them from here. */
export { go, usePath } from "@maneman/ui/router";

export type Route =
  | { readonly page: "home" }
  | { readonly page: "visits" }
  | { readonly page: "visit"; readonly id: string }
  | { readonly page: "issue"; readonly id: string }
  | { readonly page: "raise" }
  | { readonly page: "photos" }
  | { readonly page: "rewards" }
  | { readonly page: "invited" }
  | { readonly page: "profile" }
  | { readonly page: "payments" }
  | { readonly page: "entry"; readonly id: string }
  | { readonly page: "address" }
  | { readonly page: "privacy" }
  | { readonly page: "account" }
  | { readonly page: "alerts" }
  | { readonly page: "hairSystem" }
  | { readonly page: "hairSystems" };

export type Tab = "/" | "/visits" | "/photos" | "/rewards";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HOME: Route = { page: "home" };

// Maps, not objects: a path such as /constructor must not find what every object carries.
const PATHS: ReadonlyMap<string, Route> = new Map<string, Route>([
  ["/visits", { page: "visits" }],
  ["/visits/issues/new", { page: "raise" }],
  ["/photos", { page: "photos" }],
  ["/rewards", { page: "rewards" }],
  ["/rewards/invited", { page: "invited" }],
  ["/profile", { page: "profile" }],
  ["/profile/payments", { page: "payments" }],
  ["/profile/address", { page: "address" }],
  ["/profile/privacy", { page: "privacy" }],
  ["/profile/account", { page: "account" }],
  ["/alerts", { page: "alerts" }],
  ["/hair-system", { page: "hairSystem" }],
  ["/hair-systems", { page: "hairSystems" }],
]);

/** The paths the app had before, and where each now is. */
const MOVED: ReadonlyMap<string, string> = new Map([
  ["/payments", "/profile/payments"],
  ["/refer", "/rewards"],
  ["/refer/fitted", "/rewards/invited"],
  ["/replacement", "/hair-system"],
  ["/photos/compare", "/photos"],
]);

/** The path without a trailing slash, so /visits/ is /visits. */
const plain = (path: string) =>
  `/${path
    .split("/")
    .filter((part) => part !== "")
    .join("/")}`;

/** Where an old path now is, or null for a path that has not moved. */
export function movedTo(path: string): string | null {
  const at = plain(path);
  const moved = MOVED.get(at);
  if (moved !== undefined) return moved;
  const [first, second, ...rest] = at.split("/").filter((part) => part !== "");
  if (first === "payments" && second !== undefined && UUID.test(second) && rest.length === 0) {
    return `/profile/payments/${second}`;
  }
  return null;
}

export function routeOf(path: string): Route {
  const at = plain(path);
  const known = PATHS.get(at);
  if (known !== undefined) return known;
  const parts = at.split("/").filter((part) => part !== "");
  const [first, second, third, ...rest] = parts;
  if (rest.length > 0) return HOME;
  if (first === "visits" && second !== undefined && third === undefined && UUID.test(second)) {
    return { page: "visit", id: second };
  }
  if (first === "visits" && second === "issues" && third !== undefined && UUID.test(third)) {
    return { page: "issue", id: third };
  }
  if (first === "profile" && second === "payments" && third !== undefined && UUID.test(third)) {
    return { page: "entry", id: third };
  }
  return HOME;
}

/** The tab a page sits under, marked in the bar. Only the four tabs' own pages draw the bar. */
const TABS: ReadonlyMap<Route["page"], Tab> = new Map<Route["page"], Tab>([
  ["home", "/"],
  ["visits", "/visits"],
  ["photos", "/photos"],
  ["rewards", "/rewards"],
]);

export const tabOf = (route: Route): Tab | null => TABS.get(route.page) ?? null;
