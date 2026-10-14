// The ops console. Cloudflare Access decides who reaches it and mm-api records each call under that identity
// (docs/decisions/0031-access-and-audit.md), so there is no login: it opens on Tasks, or the first section the person
// may open. Most sections load the first time they open, which keeps the first load within its budget
// (scripts/lib/spa-build.ts).

import { useScreenTitle } from "@maneman/ui/useScreenTitle";
import { lazyScreen } from "@maneman/ui/lazyScreen";
import { Fragment, Suspense, useCallback, useEffect, useState, type ComponentType } from "react";
import { ClientScreen } from "./clients/ClientScreen.tsx";
import { FindClientScreen } from "./clients/FindClientScreen.tsx";
import { ClosedScreen } from "./components/ClosedScreen.tsx";
import { Shell } from "./components/Shell.tsx";
import { DispatchScreen } from "./dispatch/DispatchScreen.tsx";
import { useMayCall } from "./lib/access.ts";
import { PageRefresh } from "./lib/refresh.ts";
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
import { Loading } from "./states/States.tsx";
import { TasksScreen } from "./tasks/TasksScreen.tsx";

const SettingsScreen = lazyScreen(() =>
  import("./settings/SettingsScreen.tsx").then((module) => module.SettingsScreen),
);
const PricesScreen = lazyScreen(() => import("./prices/PricesScreen.tsx").then((module) => module.PricesScreen));
const DiscountCodesScreen = lazyScreen(() =>
  import("./discount-codes/DiscountCodesScreen.tsx").then((module) => module.DiscountCodesScreen),
);
const TechnicianPayScreen = lazyScreen(() =>
  import("./technician-pay/TechnicianPayScreen.tsx").then((module) => module.TechnicianPayScreen),
);
const PartnerCommissionScreen = lazyScreen(() =>
  import("./partner-commission/PartnerCommissionScreen.tsx").then((module) => module.PartnerCommissionScreen),
);
const StaffScreen = lazyScreen(() => import("./staff/StaffScreen.tsx").then((module) => module.StaffScreen));
const CitiesScreen = lazyScreen(() => import("./cities/CitiesScreen.tsx").then((module) => module.CitiesScreen));
// The queues ops open now and then load when opened, keeping the console's first load within its budget.
const TechniciansScreen = lazyScreen(() =>
  import("./technicians/TechniciansScreen.tsx").then((module) => module.TechniciansScreen),
);
const NoShowsScreen = lazyScreen(() => import("./payments/NoShowsScreen.tsx").then((module) => module.NoShowsScreen));
const DeletionsScreen = lazyScreen(() =>
  import("./deletion-requests/DeletionsScreen.tsx").then((module) => module.DeletionsScreen),
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
const CareSettingsScreen = lazyScreen(() =>
  import("./care/MessagesScreen.tsx").then((module) => module.CareSettingsScreen),
);
const ItemsScreen = lazyScreen(() => import("./items/ItemsScreen.tsx").then((module) => module.ItemsScreen));
const SuppliersScreen = lazyScreen(() =>
  import("./suppliers/SuppliersScreen.tsx").then((module) => module.SuppliersScreen),
);
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
  items: ItemsScreen,
  suppliers: SuppliersScreen,
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
  "care-settings": CareSettingsScreen,
  "care-numbers": CareNumbersScreen,
  spend: SpendScreen,
  targets: TargetsScreen,
  staff: StaffScreen,
  cities: CitiesScreen,
  activity: ActivityScreen,
};

/** The dispatch board and a client's record fill the frame to its edges, where every other page is padded. */
const flushOf = (route: Route): boolean =>
  route.page === "dispatch" || (route.page === "clients" && route.clientId !== null);

/** Finding a client has its own search, so the header has none there. */
const findsClients = (route: Route): boolean => route.page === "clients" && route.clientId === null;

function Page({ route, mayCall }: { route: Route; mayCall: MayCall }) {
  if (!mayOpen(mayCall, route.page)) return <ClosedScreen />;
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
  useScreenTitle(titleOf(route));
  // A page read again in place is drawn anew under its key, and the frame says why until ops move on.
  const [read, setRead] = useState({ path, round: 0, note: null as string | null });
  const shown = read.path === path ? read : { path, round: 0, note: null };
  const refresh = useCallback(
    (note: string) => {
      setRead((was) => ({ path, round: (was.path === path ? was.round : 0) + 1, note }));
    },
    [path],
  );
  useEffect(() => {
    const to = redirectOf(path, mayCall);
    // The hash names a row to land on, as "/no-shows#case-…" from an older task.
    if (to !== null) redirect(`${to}${window.location.hash}`);
  }, [path, mayCall]);
  // The frame stays as ops move between pages; the page inside it is keyed, so each opens at its top with its own
  // data, and a page that failed to draw is left behind with it.
  return (
    <Shell
      section={sectionOf(route.page).path}
      title={SECTION_NAMES[route.page]}
      flush={flushOf(route)}
      finder={!findsClients(route)}
      note={shown.note}
    >
      <PageRefresh value={refresh}>
        <Fragment key={`${keyOf(route)} ${String(shown.round)}`}>
          <PageBoundary>
            <Suspense fallback={<Loading />}>
              <Page route={route} mayCall={mayCall} />
            </Suspense>
          </PageBoundary>
        </Fragment>
      </PageRefresh>
    </Shell>
  );
}
