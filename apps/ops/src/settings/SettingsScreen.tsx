// Settings, under Admin: the rules, the days no visit is offered, the
// consumables with each service's expected use, and the job sheet the
// technician app reads with a job. Above them, one line says what the
// photographs and referral cards hold in R2 against their share.
//
// The price book, the discount codes, the service area and the Staff list are
// sections of their own departments (./PanelScreens.tsx).

import { Tabs, TAB } from "@maneman/ui/Tabs";
import { useLoad } from "@maneman/ui/useLoad";
import { api } from "../api.ts";
import { OpsLink, Shell } from "../components/Shell.tsx";
import { settings } from "../content.ts";
import { settingsPath, SETTINGS_TAB_NAMES, SETTINGS_TABS, type SettingsTab } from "../route.ts";
import { Blackouts } from "./Blackouts.tsx";
import { Consumables } from "./Consumables.tsx";
import { JobSheet } from "./JobSheet.tsx";
import { Rules } from "./Rules.tsx";
import styles from "./settings.module.css";

function Panel({ tab }: { tab: SettingsTab }) {
  if (tab === "blackouts") return <Blackouts />;
  if (tab === "consumables") return <Consumables />;
  if (tab === "job-sheet") return <JobSheet />;
  return <Rules />;
}

/** The storage meter's figure, once it is read; nothing while it is not, since the panels are what ops came for. */
function Storage() {
  const [loaded] = useLoad(api.storage);
  if (loaded.state !== "loaded") return null;
  return <p className={styles.storage}>{settings.storage(loaded.value.held_bytes, loaded.value.share_bytes)}</p>;
}

export function SettingsScreen({ tab }: { tab: SettingsTab }) {
  return (
    <Shell section="/settings" title={settings.title} sub={settings.sub}>
      <div className={styles.screen}>
        <Storage />
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
