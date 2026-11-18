// What a page shows while its code loads, the first time it opens: its own head, and the tab bar on a tab's own page,
// so the frame never drops away and leaves no way back.

import { Loading } from "@maneman/ui/States";
import { profile, titles } from "../content.ts";
import { backOf, tabOf, type Route } from "../route.ts";
import { Shell } from "./Shell.tsx";

function headerOf(route: Route) {
  if (route.page === "home") return { kind: "home" } as const;
  if (tabOf(route) !== null) return { kind: "tab", title: titles[route.page] } as const;
  // The profile's own heading is the client's name, so its head has none.
  const title = route.page === "profile" ? undefined : titles[route.page];
  return { kind: "back", ...(title === undefined ? {} : { title }), to: backOf(route), label: profile.back } as const;
}

export function PageLoading({ route }: { route: Route }) {
  return (
    <Shell header={headerOf(route)} tab={tabOf(route)}>
      <Loading />
    </Shell>
  );
}
