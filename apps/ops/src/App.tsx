// The ops console. There is no login here: Cloudflare Access decides who
// reaches the host, and mm-api checks its token on every call and records the
// identity (docs/decisions/0031-access-and-audit.md). The console therefore
// opens straight on a section: Tasks, or the first the person may open.

import { Fragment, useEffect, type ComponentType } from "react";
import { ClientScreen } from "./clients/ClientScreen.tsx";
import { FindClientScreen } from "./clients/FindClientScreen.tsx";
import { ClosedScreen } from "./components/ClosedScreen.tsx";
import { DeletionsScreen } from "./deletions/DeletionsScreen.tsx";
import { DispatchScreen } from "./dispatch/DispatchScreen.tsx";
import { GrievancesScreen } from "./grievances/GrievancesScreen.tsx";
import { useMayCall } from "./lib/access.ts";
import { NoShowsScreen } from "./no-shows/NoShowsScreen.tsx";
import { NumberChangesScreen } from "./number-changes/NumberChangesScreen.tsx";
import { ReferralsScreen } from "./referrals/ReferralsScreen.tsx";
import {
  keyOf,
  mayOpen,
  redirect,
  redirectOf,
  routeOf,
  titleOf,
  usePath,
  type MayCall,
  type PlainPage,
  type Route,
} from "./route.ts";
import { DiscountCodesScreen, PricesScreen, ServiceAreaScreen, StaffScreen } from "./settings/PanelScreens.tsx";
import { SettingsScreen } from "./settings/SettingsScreen.tsx";
import { StockScreen } from "./stock/StockScreen.tsx";
import { TasksScreen } from "./tasks/TasksScreen.tsx";
import { TechniciansScreen } from "./technicians/TechniciansScreen.tsx";
import { WaitlistScreen } from "./waitlist/WaitlistScreen.tsx";

/** The screen each section of one page opens on. */
const SCREENS: Readonly<Record<PlainPage, ComponentType>> = {
  tasks: TasksScreen,
  dispatch: DispatchScreen,
  technicians: TechniciansScreen,
  stock: StockScreen,
  grievances: GrievancesScreen,
  "number-changes": NumberChangesScreen,
  "deletion-requests": DeletionsScreen,
  "no-shows": NoShowsScreen,
  prices: PricesScreen,
  "discount-codes": DiscountCodesScreen,
  referrals: ReferralsScreen,
  waitlist: WaitlistScreen,
  "service-area": ServiceAreaScreen,
  staff: StaffScreen,
};

function Page({ route, mayCall }: { route: Route; mayCall: MayCall }) {
  if (!mayOpen(mayCall, route.page)) return <ClosedScreen page={route.page} />;
  if (route.page === "settings") return <SettingsScreen tab={route.tab} />;
  if (route.page === "clients") {
    if (route.clientId === null) return <FindClientScreen />;
    return <ClientScreen clientId={route.clientId} tab={route.tab} />;
  }
  const Screen = SCREENS[route.page];
  return <Screen />;
}

export function App() {
  const path = usePath();
  const route = routeOf(path);
  const mayCall = useMayCall();
  const title = titleOf(route);
  useEffect(() => {
    document.title = title;
  }, [title]);
  useEffect(() => {
    const to = redirectOf(path, mayCall);
    if (to !== null) redirect(to);
  }, [path, mayCall]);
  // Keyed by the path, so each section opens at its top with its own data.
  return (
    <Fragment key={keyOf(route)}>
      <Page route={route} mayCall={mayCall} />
    </Fragment>
  );
}
