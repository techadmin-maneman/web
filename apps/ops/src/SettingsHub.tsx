// Settings: everything the console is set up with, a page each, under a menu of its own by group (route.ts,
// SETTINGS_PAGES). The menu lists only the pages the person may open; a page of policies draws its rule groups, and
// every other page is its own screen, loaded the first time it opens.

import { lazyScreen } from "@maneman/ui/lazyScreen";
import { SettingsLayout, SubNav } from "@maneman/ui/SettingsLayout";
import { Suspense, type ComponentType } from "react";
import { shell } from "./content.ts";
import { useMayCall } from "./lib/access.ts";
import {
  mayOpenSetting,
  settingsPageOf,
  settingsPath,
  SETTINGS_GROUP_NAMES,
  SETTINGS_GROUPS,
  SETTINGS_PAGE_NAMES,
  SETTINGS_PAGES,
  type ScreenTab,
  type SettingsTab,
} from "./route.ts";
import { Rules } from "./settings/Rules.tsx";
import { Loading } from "./states/States.tsx";

/** Each page that is a screen of its own, loaded the first time it opens. */
const SCREENS: Readonly<Record<ScreenTab, ComponentType>> = {
  cities: lazyScreen(() => import("./cities/CitiesScreen.tsx").then((module) => module.CitiesScreen)),
  areas: lazyScreen(() => import("./areas/Served.tsx").then((module) => module.Served)),
  targets: lazyScreen(() => import("./targets/TargetsScreen.tsx").then((module) => module.TargetsScreen)),
  "window-times": lazyScreen(() => import("./settings/WindowTimes.tsx").then((module) => module.WindowTimes)),
  "closed-days": lazyScreen(() => import("./settings/Blackouts.tsx").then((module) => module.Blackouts)),
  "job-sheet": lazyScreen(() => import("./settings/JobSheet.tsx").then((module) => module.JobSheet)),
  services: lazyScreen(() => import("./prices/Services.tsx").then((module) => module.Services)),
  "hair-systems": lazyScreen(() => import("./prices/StandardCosts.tsx").then((module) => module.StandardCosts)),
  "discount-codes": lazyScreen(() =>
    import("./discount-codes/DiscountCodesScreen.tsx").then((module) => module.DiscountCodesScreen),
  ),
  partners: lazyScreen(() => import("./referrals/Partners.tsx").then((module) => module.Partners)),
  words: lazyScreen(() => import("./words/WordsScreen.tsx").then((module) => module.WordsScreen)),
  "care-team": lazyScreen(() => import("./care/MessagesScreen.tsx").then((module) => module.CareTeamScreen)),
  remedies: lazyScreen(() => import("./care/MessagesScreen.tsx").then((module) => module.RemediesScreen)),
  "quick-replies": lazyScreen(() => import("./care/MessagesScreen.tsx").then((module) => module.QuickRepliesScreen)),
  staff: lazyScreen(() => import("./staff/StaffScreen.tsx").then((module) => module.StaffScreen)),
  "pay-grades": lazyScreen(() =>
    import("./technician-pay/TechnicianPayScreen.tsx").then((module) => module.PayGradesScreen),
  ),
};

function Menu({ tab }: { tab: SettingsTab }) {
  const mayCall = useMayCall();
  const groups = SETTINGS_GROUPS.map((group) => ({
    name: SETTINGS_GROUP_NAMES[group],
    items: SETTINGS_PAGES.filter((page) => page.group === group && mayOpenSetting(mayCall, page.tab)).map((page) => ({
      name: SETTINGS_PAGE_NAMES[page.tab],
      to: settingsPath(page.tab),
      current: page.tab === tab,
    })),
  }));
  return <SubNav label={shell.settings} groups={groups} />;
}

function Page({ tab }: { tab: SettingsTab }) {
  const page = settingsPageOf(tab);
  if ("rules" in page) return <Rules groups={page.rules} />;
  const Screen = SCREENS[page.tab];
  return <Screen />;
}

export function SettingsScreen({ tab }: { tab: SettingsTab }) {
  return (
    <SettingsLayout menu={<Menu tab={tab} />}>
      <Suspense fallback={<Loading />}>
        <Page tab={tab} />
      </Suspense>
    </SettingsLayout>
  );
}
