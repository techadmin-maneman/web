// Settings, under Admin: the rules, the days no visit is offered, the
// consumables with each service's expected use, and the job sheet the
// technician app reads with a job.
//
// The price book, the discount codes, the service area and the Staff list are
// sections of their own departments (./PanelScreens.tsx).

import { Tabs, TAB } from "@maneman/ui/Tabs";
import { OpsLink, Shell } from "../components/Shell.tsx";
import { settings } from "../content.ts";
import { settingsPath, SETTINGS_TAB_NAMES, SETTINGS_TABS, type SettingsTab } from "../route.ts";
import { Blackouts } from "./Blackouts.tsx";
import { Consumables } from "./Consumables.tsx";
import { JobSheet } from "./JobSheet.tsx";
import { Rules } from "./Rules.tsx";
import styles from "../components/forms.module.css";

function Panel({ tab }: { tab: SettingsTab }) {
  if (tab === "blackouts") return <Blackouts />;
  if (tab === "consumables") return <Consumables />;
  if (tab === "job-sheet") return <JobSheet />;
  return <Rules />;
}

export function SettingsScreen({ tab }: { tab: SettingsTab }) {
  return (
    <Shell section="/settings" title={settings.title} sub={settings.sub}>
      <div className={styles.screen}>
        <Tabs label={settings.title}>
          {SETTINGS_TABS.map((each) => (
            <OpsLink key={each} className={TAB} to={settingsPath(each)} current={each === tab}>
              {SETTINGS_TAB_NAMES[each]}
            </OpsLink>
          ))}
        </Tabs>
        <Panel tab={tab} />
      </div>
    </Shell>
  );
}
