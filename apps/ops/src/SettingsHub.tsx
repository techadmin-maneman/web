// Settings: everything the console is set up with, a page each, under a menu of its own by group (route.ts,
// SETTINGS_PAGES). The menu lists only the pages the person may open, folded but for the open page's group, with a
// search across the pages and every rule; a page of policies draws its rule groups, and every other page is its own
// screen, loaded the first time it opens.

import { lazyScreen } from "@maneman/ui/lazyScreen";
import { Note } from "@maneman/ui/Note";
import { SearchInput } from "@maneman/ui/SearchInput";
import { SettingsLayout, SubNav } from "@maneman/ui/SettingsLayout";
import { Suspense, useEffect, useState, type ComponentType } from "react";
import type { OpsSetting } from "./api.ts";
import { shell } from "./content.ts";
import { settings as copy } from "./content/settings.ts";
import { useMayCall } from "./lib/access.ts";
import {
  mayOpenSetting,
  rulePageOf,
  rulePath,
  settingsPageOf,
  settingsPath,
  SETTINGS_GROUP_NAMES,
  SETTINGS_GROUPS,
  SETTINGS_PAGE_NAMES,
  SETTINGS_PAGES,
  type ScreenTab,
  type SettingsPage,
  type SettingsTab,
} from "./route.ts";
import { Rules } from "./settings/Rules.tsx";
import { settingsApi } from "./settings/settings-api.ts";
import { Loading } from "./states/States.tsx";

/** Each page that is a screen of its own, loaded the first time it opens. */
const SCREENS: Readonly<Record<ScreenTab, ComponentType>> = {
  cities: lazyScreen(() => import("./cities/CitiesScreen.tsx").then((module) => module.CitiesScreen)),
  areas: lazyScreen(() => import("./areas/Served.tsx").then((module) => module.Served)),
  targets: lazyScreen(() => import("./targets/TargetsScreen.tsx").then((module) => module.TargetsScreen)),
  "window-times": lazyScreen(() => import("./settings/WindowTimes.tsx").then((module) => module.WindowTimes)),
  "closed-days": lazyScreen(() => import("./settings/Blackouts.tsx").then((module) => module.Blackouts)),
  "job-sheet": lazyScreen(() => import("./settings/JobSheet.tsx").then((module) => module.JobSheet)),
  packages: lazyScreen(() => import("./packages/PackagesScreen.tsx").then((module) => module.PackagesScreen)),
  services: lazyScreen(() => import("./prices/Services.tsx").then((module) => module.Services)),
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

/** Every rule, read once a search starts so a rule is found by its title and note; none before then. */
function useRules(wanted: boolean): readonly OpsSetting[] {
  const [rules, setRules] = useState<readonly OpsSetting[]>([]);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    void settingsApi.settings().then(
      (answer) => {
        if (live && answer.ok) setRules(answer.body.settings);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [wanted]);
  return rules;
}

const holds = (text: string, typed: string) => text.toLocaleLowerCase("en-IN").includes(typed);

/**
 * The menu's groups: the pages a search names by their name and the rules by their title or note, or every page while
 * nothing is typed.
 */
function menuOf(pages: readonly SettingsPage[], rules: readonly OpsSetting[], typed: string, tab: SettingsTab) {
  return SETTINGS_GROUPS.map((group) => ({
    name: SETTINGS_GROUP_NAMES[group],
    items: [
      ...pages
        .filter((page) => page.group === group && holds(SETTINGS_PAGE_NAMES[page.tab], typed))
        .map((page) => ({
          name: SETTINGS_PAGE_NAMES[page.tab],
          to: settingsPath(page.tab),
          current: page.tab === tab,
        })),
      ...rules
        .filter(
          (rule) => rulePageOf(rule.name).group === group && (holds(rule.title, typed) || holds(rule.note, typed)),
        )
        .map((rule) => ({ name: rule.title, to: rulePath(rule.name), current: false })),
    ],
  }));
}

function Menu({ tab }: { tab: SettingsTab }) {
  const mayCall = useMayCall();
  const [typed, setTyped] = useState("");
  const pages = SETTINGS_PAGES.filter((page) => mayOpenSetting(mayCall, page.tab));
  const query = typed.trim().toLocaleLowerCase("en-IN");
  const rules = useRules(query !== "" && pages.some((page) => "rules" in page));
  const groups = menuOf(pages, query === "" ? [] : rules, query, tab);
  return (
    <SubNav label={shell.settings} groups={groups} unfolded={query !== ""}>
      <SearchInput label={copy.find} value={typed} maxLength={80} onChange={setTyped} />
      {groups.every((group) => group.items.length === 0) && <Note>{copy.noneFound}</Note>}
    </SubNav>
  );
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
