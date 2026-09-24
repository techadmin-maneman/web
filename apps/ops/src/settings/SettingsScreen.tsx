// Settings, the eighth section of the design's navigation and the one it
// letters nothing inside (docs/decisions/0061-ops-editable-inputs.md). Three
// panels, because the three hold their history differently: a rule applies from
// the moment it is set, a price applies from a date and keeps every earlier
// row, and a pincode's launch date is a promise the waitlist counts from.

import { Shell } from "../components/Shell.tsx";
import { settings } from "../content.ts";
import { OpsLink } from "../components/Shell.tsx";
import type { SettingsTab } from "../route.ts";
import { Prices } from "./Prices.tsx";
import { Rules } from "./Rules.tsx";
import { ServiceArea } from "./ServiceArea.tsx";
import styles from "./settings.module.css";

export function SettingsScreen({ tab }: { tab: SettingsTab }) {
  return (
    <Shell section="/settings" title={settings.title} sub={settings.sub}>
      <div className={styles.column}>
        <nav className={styles.tabs} aria-label={settings.title}>
          {settings.tabs.map((each) => (
            <OpsLink key={each.tab} className={styles.tab} to={each.path} current={each.tab === tab}>
              {each.label}
            </OpsLink>
          ))}
        </nav>
        {tab === "rules" ? <Rules /> : tab === "prices" ? <Prices /> : <ServiceArea />}
      </div>
    </Shell>
  );
}
