// Settings, the eighth section of the design's navigation and the one it
// letters nothing inside (docs/decisions/0061-ops-editable-inputs.md). Three
// panels, because the three hold their history differently: a rule applies from
// the moment it is set, a price applies from a date and keeps every earlier
// row, and a pincode's launch date is a promise the waitlist counts from. The
// prices sit with the services they price, which ops keep in the same panel
// (docs/decisions/0085-services-ops-can-edit.md).

import { Tabs, TAB } from "@maneman/ui/Tabs";
import { OpsLink, Shell } from "../components/Shell.tsx";
import { settings } from "../content.ts";
import { settingsPath, SETTINGS_TAB_NAMES, SETTINGS_TABS, type SettingsTab } from "../route.ts";
import { Services } from "./Services.tsx";
import { Rules } from "./Rules.tsx";
import { ServiceArea } from "./ServiceArea.tsx";
import styles from "./settings.module.css";

function Panel({ tab }: { tab: SettingsTab }) {
  if (tab === "prices") return <Services />;
  if (tab === "area") return <ServiceArea />;
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
