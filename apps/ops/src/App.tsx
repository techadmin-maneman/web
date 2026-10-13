// The ops console. There is no login here: Cloudflare Access decides who
// reaches the host, and mm-api checks its token on every call and records the
// identity (docs/decisions/0031-access-and-audit.md). The console therefore
// opens straight on a section: Tasks, or the first the person may open.
//
// Areas, the settings sections and a technician's page load the first time they open, so
// the console's first load stays within its 150 KB budget (scripts/lib/spa-build.ts).

import { lazyScreen } from "@maneman/ui/lazyScreen";
import { Fragment, Suspense, useEffect, type ComponentType } from "react";
import { ClientScreen } from "./clients/ClientScreen.tsx";
import { FindClientScreen } from "./clients/FindClientScreen.tsx";
import { ClosedScreen } from "./components/ClosedScreen.tsx";
import { DispatchScreen } from "./dispatch/DispatchScreen.tsx";
import { useMayCall } from "./lib/access.ts";
import {
  keyOf,
  mayOpen,
  redirect,
  redirectOf,
  routeOf,
  SECTION_NAMES,
  sectionOf,
  titleOf,
  usePath,
  type MayCall,
  type PlainPage,
  type Route,
} from "./route.ts";
import { PageBoundary } from "./states/ErrorBoundary.tsx";
import { TasksScreen } from "./tasks/TasksScreen.tsx";

const SettingsScreen = lazyScreen(() =>
  import("./settings/SettingsScreen.tsx").then((module) => module.SettingsScreen),
);
const PricesScreen = lazyScreen(() => import("./settings/PanelScreens.tsx").then((module) => module.PricesScreen));
const DiscountCodesScreen = lazyScreen(() =>
  import("./settings/PanelScreens.tsx").then((module) => module.DiscountCodesScreen),
);
const TechnicianPayScreen = lazyScreen(() =>
  import("./settings/PanelScreens.tsx").then((module) => module.TechnicianPayScreen),
);
const PartnerCommissionScreen = lazyScreen(() =>
  import("./settings/PanelScreens.tsx").then((module) => module.PartnerCommissionScreen),
);
const StaffScreen = lazyScreen(() => import("./settings/PanelScreens.tsx").then((module) => module.StaffScreen));
// The queues ops open now and then load when opened, keeping the console's first load within its budget.
const TechniciansScreen = lazyScreen(() =>
  import("./technicians/TechniciansScreen.tsx").then((module) => module.TechniciansScreen),
);
const NoShowsScreen = lazyScreen(() => import("./no-shows/NoShowsScreen.tsx").then((module) => module.NoShowsScreen));
const DeletionsScreen = lazyScreen(() =>
  import("./deletions/DeletionsScreen.tsx").then((module) => module.DeletionsScreen),
);
const GrievancesScreen = lazyScreen(() =>
  import("./grievances/GrievancesScreen.tsx").then((module) => module.GrievancesScreen),
);
const NumberChangesScreen = lazyScreen(() =>
  import("./number-changes/NumberChangesScreen.tsx").then((module) => module.NumberChangesScreen),
);
const ReferralsScreen = lazyScreen(() =>
  import("./referrals/ReferralsScreen.tsx").then((module) => module.ReferralsScreen),
);
const ActivityScreen = lazyScreen(() =>
  import("./activity/ActivityScreen.tsx").then((module) => module.ActivityScreen),
);
const AreasScreen = lazyScreen(() => import("./areas/AreasScreen.tsx").then((module) => module.AreasScreen));
const MessagesScreen = lazyScreen(() => import("./care/MessagesScreen.tsx").then((module) => module.MessagesScreen));
const TargetsScreen = lazyScreen(() => import("./targets/TargetsScreen.tsx").then((module) => module.TargetsScreen));
const StockScreen = lazyScreen(() => import("./stock/StockScreen.tsx").then((module) => module.StockScreen));
const PurchasingScreen = lazyScreen(() =>
  import("./purchasing/PurchasingScreen.tsx").then((module) => module.PurchasingScreen),
);
const CountsScreen = lazyScreen(() => import("./counts/CountsScreen.tsx").then((module) => module.CountsScreen));
const UsageScreen = lazyScreen(() => import("./usage/UsageScreen.tsx").then((module) => module.UsageScreen));
const QualityScreen = lazyScreen(() => import("./quality/QualityScreen.tsx").then((module) => module.QualityScreen));
const SupplyPlanScreen = lazyScreen(() =>
  import("./supply-plan/SupplyPlanScreen.tsx").then((module) => module.SupplyPlanScreen),
);
const SpendScreen = lazyScreen(() => import("./spend/SpendScreen.tsx").then((module) => module.SpendScreen));
const CareNumbersScreen = lazyScreen(() =>
  import("./care/CareNumbersScreen.tsx").then((module) => module.CareNumbersScreen),
);
const WordsScreen = lazyScreen(() => import("./words/WordsScreen.tsx").then((module) => module.WordsScreen));
const TechnicianScreen = lazyScreen(() =>
  import("./technicians/TechnicianScreen.tsx").then((module) => module.TechnicianScreen),
);

/** The screen each section of one page opens on. */
const SCREENS: Readonly<Record<PlainPage, ComponentType>> = {
  tasks: TasksScreen,
  dispatch: DispatchScreen,
  stock: StockScreen,
  purchasing: PurchasingScreen,
  "supply-plan": SupplyPlanScreen,
  counts: CountsScreen,
  usage: UsageScreen,
  quality: QualityScreen,
  grievances: GrievancesScreen,
  "number-changes": NumberChangesScreen,
  "deletion-requests": DeletionsScreen,
  payments: NoShowsScreen,
  prices: PricesScreen,
  "discount-codes": DiscountCodesScreen,
  "technician-pay": TechnicianPayScreen,
  "partner-commission": PartnerCommissionScreen,
  referrals: ReferralsScreen,
  words: WordsScreen,
  messages: MessagesScreen,
  "care-numbers": CareNumbersScreen,
  spend: SpendScreen,
  targets: TargetsScreen,
  staff: StaffScreen,
  activity: ActivityScreen,
};

function Page({ route, mayCall }: { route: Route; mayCall: MayCall }) {
  if (!mayOpen(mayCall, route.page)) return <ClosedScreen page={route.page} />;
  if (route.page === "settings") return <SettingsScreen tab={route.tab} />;
  if (route.page === "areas") return <AreasScreen tab={route.tab} />;
  if (route.page === "clients") {
    if (route.clientId === null) return <FindClientScreen />;
    return <ClientScreen clientId={route.clientId} tab={route.tab} />;
  }
  if (route.page === "technicians") {
    if (route.technicianId === null) return <TechniciansScreen />;
    return <TechnicianScreen technicianId={route.technicianId} tab={route.tab} />;
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
    // The hash names a row to land on, as "/no-shows#case-…" from an older task.
    if (to !== null) redirect(`${to}${window.location.hash}`);
  }, [path, mayCall]);
  // Keyed by the page, so each section opens at its top with its own data, and a page that failed to draw is left
  // behind with it.
  return (
    <Fragment key={keyOf(route)}>
      <PageBoundary section={sectionOf(route.page).path} title={SECTION_NAMES[route.page]}>
        <Suspense fallback={null}>
          <Page route={route} mayCall={mayCall} />
        </Suspense>
      </PageBoundary>
    </Fragment>
  );
}
