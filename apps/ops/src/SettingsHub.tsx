// Settings: everything the console is set up with, a page each, by group (route.ts, SETTINGS_PAGES), as the redesign
// draws it: the groups beneath Settings in the navigation (a tab each on a phone), the open group's pages a tab each,
// and a search across the pages and every rule beside them, what it finds above the page. A page of policies draws
// its rule groups; every other page is its own screen, loaded the first time it opens.

import { ACTION_ICONS } from "@maneman/brand/action-icons";
import { Button } from "@maneman/ui/Button";
import { EmptyState } from "@maneman/ui/EmptyState";
import { lazyScreen } from "@maneman/ui/lazyScreen";
import { ListRow, ListRows } from "@maneman/ui/ListRow";
import { Panel } from "@maneman/ui/Panel";
import { Link } from "@maneman/ui/router";
import { SearchInput } from "@maneman/ui/SearchInput";
import { SettingsLayout } from "@maneman/ui/SettingsLayout";
import { Tabs, TAB } from "@maneman/ui/Tabs";
import { Suspense, useEffect, useState, type ComponentType } from "react";
import type { OpsSetting } from "./api.ts";
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
import { PanelLoading } from "@maneman/ui/States";
import styles from "./settings-hub.module.css";

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

/** A match a search finds: a page by its name, or a rule by its title or note, with the group and page it is in. */
interface Match {
  readonly key: string;
  readonly name: string;
  readonly where: string;
  readonly to: string;
}

function matchesOf(pages: readonly SettingsPage[], rules: readonly OpsSetting[], typed: string): Match[] {
  return [
    ...pages
      .filter((page) => holds(SETTINGS_PAGE_NAMES[page.tab], typed))
      .map((page) => ({
        key: page.tab,
        name: SETTINGS_PAGE_NAMES[page.tab],
        where: copy.pageIn(SETTINGS_GROUP_NAMES[page.group]),
        to: settingsPath(page.tab),
      })),
    ...rules
      .filter((rule) => holds(rule.title, typed) || holds(rule.note, typed))
      .map((rule) => {
        const page = rulePageOf(rule.name);
        return {
          key: rule.name,
          name: rule.title,
          where: copy.ruleIn(SETTINGS_GROUP_NAMES[page.group], SETTINGS_PAGE_NAMES[page.tab]),
          to: rulePath(rule.name),
        };
      }),
  ];
}

/** What a search finds across every page the person may open, above the page, with the way to clear it. */
function Matches({ typed, onClear }: { typed: string; onClear: () => void }) {
  const mayCall = useMayCall();
  const pages = SETTINGS_PAGES.filter((page) => mayOpenSetting(mayCall, page.tab));
  const rules = useRules(pages.some((page) => "rules" in page));
  const found = matchesOf(
    pages,
    rules.filter((rule) => pages.some((page) => page.tab === rulePageOf(rule.name).tab)),
    typed,
  );
  return (
    <Panel
      titleId="settings-matches"
      title={copy.matches}
      actions={
        <Button icon={ACTION_ICONS.x} variant="outline" size="small" onClick={onClear}>
          {copy.clear}
        </Button>
      }
    >
      {found.length === 0 ? (
        <EmptyState look="panel" line={copy.noneFound} />
      ) : (
        <ListRows inPanel>
          {found.map((each) => (
            <ListRow key={each.key} title={each.name} meta={each.where} to={each.to} chevron />
          ))}
        </ListRows>
      )}
    </Panel>
  );
}

/** The open page's group's pages, a tab each, and the search across every page, as the redesign draws Settings. */
function SettingsBar({ tab, typed, onTyped }: { tab: SettingsTab; typed: string; onTyped: (typed: string) => void }) {
  const mayCall = useMayCall();
  const { group } = settingsPageOf(tab);
  const pages = SETTINGS_PAGES.filter((page) => page.group === group && mayOpenSetting(mayCall, page.tab));
  return (
    <div className={styles.bar}>
      <Tabs label={SETTINGS_GROUP_NAMES[group]}>
        {pages.map((page) => (
          <Link key={page.tab} className={TAB} to={settingsPath(page.tab)} current={page.tab === tab}>
            {SETTINGS_PAGE_NAMES[page.tab]}
          </Link>
        ))}
      </Tabs>
      <SearchInput label={copy.find} value={typed} maxLength={80} onChange={onTyped} className={styles.find} />
    </div>
  );
}

/** On a phone, where the navigation is not drawn, Settings' groups, a tab each, opening each on its first page. */
function GroupTabs({ tab }: { tab: SettingsTab }) {
  const mayCall = useMayCall();
  const { group: open } = settingsPageOf(tab);
  return (
    <Tabs label={copy.groups} className={styles.groups}>
      {SETTINGS_GROUPS.map((group) => {
        const first = SETTINGS_PAGES.find((page) => page.group === group && mayOpenSetting(mayCall, page.tab));
        return first === undefined ? null : (
          <Link key={group} className={TAB} to={settingsPath(first.tab)} current={group === open}>
            {SETTINGS_GROUP_NAMES[group]}
          </Link>
        );
      })}
    </Tabs>
  );
}

function Page({ tab }: { tab: SettingsTab }) {
  const page = settingsPageOf(tab);
  if ("rules" in page) return <Rules groups={page.rules} />;
  const Screen = SCREENS[page.tab];
  return <Screen />;
}

export function SettingsScreen({ tab }: { tab: SettingsTab }) {
  const [typed, setTyped] = useState("");
  const query = typed.trim().toLocaleLowerCase("en-IN");
  return (
    <SettingsLayout>
      <GroupTabs tab={tab} />
      <SettingsBar tab={tab} typed={typed} onTyped={setTyped} />
      {query !== "" && (
        <Matches
          typed={query}
          onClear={() => {
            setTyped("");
          }}
        />
      )}
      <Suspense fallback={<PanelLoading />}>
        <Page tab={tab} />
      </Suspense>
    </SettingsLayout>
  );
}
