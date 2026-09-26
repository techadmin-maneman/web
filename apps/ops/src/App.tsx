// The ops console. There is no login here: Cloudflare Access decides who
// reaches the host, and mm-api checks its token on every call and records the
// identity (docs/decisions/0031-access-and-audit.md). The console therefore
// opens straight on a section.

import { Fragment, useEffect, type ComponentType } from "react";
import { ClientScreen } from "./clients/ClientScreen.tsx";
import { FindClientScreen } from "./clients/FindClientScreen.tsx";
import { DeletionsScreen } from "./deletions/DeletionsScreen.tsx";
import { DispatchScreen } from "./dispatch/DispatchScreen.tsx";
import { GrievancesScreen } from "./grievances/GrievancesScreen.tsx";
import { NoShowsScreen } from "./no-shows/NoShowsScreen.tsx";
import { NumberChangesScreen } from "./number-changes/NumberChangesScreen.tsx";
import { ReferralsScreen } from "./referrals/ReferralsScreen.tsx";
import { keyOf, routeOf, titleOf, usePath, type PlainPage, type Route } from "./route.ts";
import { SettingsScreen } from "./settings/SettingsScreen.tsx";
import { TasksScreen } from "./tasks/TasksScreen.tsx";
import { TechniciansScreen } from "./technicians/TechniciansScreen.tsx";
import { WaitlistScreen } from "./waitlist/WaitlistScreen.tsx";

/** The screen each section of one page opens on. */
const SCREENS: Readonly<Record<PlainPage, ComponentType>> = {
  dispatch: DispatchScreen,
  "no-shows": NoShowsScreen,
  referrals: ReferralsScreen,
  waitlist: WaitlistScreen,
  tasks: TasksScreen,
  technicians: TechniciansScreen,
  grievances: GrievancesScreen,
  "deletion-requests": DeletionsScreen,
  "number-changes": NumberChangesScreen,
};

function Page({ route }: { route: Route }) {
  if (route.page === "settings") return <SettingsScreen tab={route.tab} />;
  if (route.page === "clients") {
    if (route.clientId === null) return <FindClientScreen />;
    return <ClientScreen clientId={route.clientId} tab={route.tab} />;
  }
  const Screen = SCREENS[route.page];
  return <Screen />;
}

export function App() {
  const route = routeOf(usePath());
  const title = titleOf(route);
  useEffect(() => {
    document.title = title;
  }, [title]);
  // Keyed by the path, so each section opens at its top with its own data.
  return (
    <Fragment key={keyOf(route)}>
      <Page route={route} />
    </Fragment>
  );
}
