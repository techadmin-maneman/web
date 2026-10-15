// Admin › Settings: the rules, the days no visit is offered, the day's window times, and the job sheet. The price book, discount codes,
// technicians' pay, partners' commission, the Staff list, the items and the suppliers are sections of their own, each
// in its own folder.

import { Tabs, TAB } from "@maneman/ui/Tabs";
import { OpsLink } from "../components/Shell.tsx";
import { settings } from "../content/settings.ts";
import { settingsPath, SETTINGS_TAB_NAMES, SETTINGS_TABS, type SettingsTab } from "../route.ts";
import { Blackouts } from "./Blackouts.tsx";
import { JobSheet } from "./JobSheet.tsx";
import { Rules } from "./Rules.tsx";
import { WindowTimes } from "./WindowTimes.tsx";
import form from "../components/forms.module.css";

function Panel({ tab }: { tab: SettingsTab }) {
  if (tab === "blackouts") return <Blackouts />;
  if (tab === "window-times") return <WindowTimes />;
  if (tab === "job-sheet") return <JobSheet />;
  return <Rules />;
}

export function SettingsScreen({ tab }: { tab: SettingsTab }) {
  return (
    <div className={form.screen}>
      <Tabs label={settings.title}>
        {SETTINGS_TABS.map((each) => (
          <OpsLink key={each} className={TAB} to={settingsPath(each)} current={each === tab}>
            {SETTINGS_TAB_NAMES[each]}
          </OpsLink>
        ))}
      </Tabs>
      <Panel tab={tab} />
    </div>
  );
}
