// Settings, under Admin: the rules, the days no visit is offered, and the job sheet the technician app reads with a
// job.
//
// The price book, the discount codes, the service area and the Staff list are sections of their own departments
// (./PanelScreens.tsx); the items we stock and the suppliers we buy them from are Inventory's (ItemsScreen,
// SuppliersScreen).

import { Tabs, TAB } from "@maneman/ui/Tabs";
import { OpsLink, Shell } from "../components/Shell.tsx";
import { settings } from "../content/settings.ts";
import { SECTION_NAMES, settingsPath, SETTINGS_TAB_NAMES, SETTINGS_TABS, type SettingsTab } from "../route.ts";
import { Blackouts } from "./Blackouts.tsx";
import { Consumables } from "./Consumables.tsx";
import { JobSheet } from "./JobSheet.tsx";
import { Rules } from "./Rules.tsx";
import { Suppliers } from "./Suppliers.tsx";
import styles from "../components/forms.module.css";

function Panel({ tab }: { tab: SettingsTab }) {
  if (tab === "blackouts") return <Blackouts />;
  if (tab === "job-sheet") return <JobSheet />;
  return <Rules />;
}

/** The items we stock, each service's expected use, and the hair systems: a tab of Inventory. */
export function ItemsScreen() {
  return (
    <Shell section="/items" title={SECTION_NAMES.items}>
      <div className={styles.screen}>
        <Consumables />
      </div>
    </Shell>
  );
}

/** The suppliers we buy from, and what each supplies: a tab of Inventory. */
export function SuppliersScreen() {
  return (
    <Shell section="/suppliers" title={SECTION_NAMES.suppliers}>
      <div className={styles.screen}>
        <Suppliers />
      </div>
    </Shell>
  );
}

export function SettingsScreen({ tab }: { tab: SettingsTab }) {
  return (
    <Shell section="/settings" title={settings.title}>
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
