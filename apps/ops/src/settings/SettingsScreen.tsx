// Settings, under Admin: the rules, the days no visit is offered, and the job sheet. The price book, discount codes,
// service area and Staff list are sections of their own departments (./PanelScreens.tsx); the items and suppliers are
// Inventory's.

import { Tabs, TAB } from "@maneman/ui/Tabs";
import { OpsLink } from "../components/Shell.tsx";
import { settings } from "../content/settings.ts";
import { settingsPath, SETTINGS_TAB_NAMES, SETTINGS_TABS, type SettingsTab } from "../route.ts";
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
    <>
      <div className={styles.screen}>
        <Consumables />
      </div>
    </>
  );
}

/** The suppliers we buy from, and what each supplies: a tab of Inventory. */
export function SuppliersScreen() {
  return (
    <>
      <div className={styles.screen}>
        <Suppliers />
      </div>
    </>
  );
}

export function SettingsScreen({ tab }: { tab: SettingsTab }) {
  return (
    <>
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
    </>
  );
}
