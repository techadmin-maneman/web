// Areas, under Growth: Waiting, who waits in each pincode, and Served, every pincode we hold. Either one marks a
// pincode live, through the same launch panel. Served lists every city's pincodes, so it shows only to those whose
// call to it goes ahead.

import { Tabs, TAB } from "@maneman/ui/Tabs";
import { OpsLink, Shell } from "../components/Shell.tsx";
import { areas } from "../content.ts";
import { useAccess, type OpsCall } from "../lib/access.ts";
import { AREA_TAB_NAMES, AREA_TABS, areasPath, type AreaTab } from "../route.ts";
import styles from "./areas.module.css";
import { Served } from "./Served.tsx";
import { Waiting } from "./Waiting.tsx";

/** The call each tab opens with. Served lists every pincode in every city, so it asks a national grant. */
const TAB_READS: Readonly<Record<AreaTab, OpsCall>> = {
  waiting: "GET /api/waitlist",
  served: "GET /api/service-area",
};

function Panel({ tab, mayOpen }: { tab: AreaTab; mayOpen: boolean }) {
  if (!mayOpen) return <p className={styles.closed}>{areas.servedClosed}</p>;
  if (tab === "served") return <Served />;
  return <Waiting />;
}

export function AreasScreen({ tab }: { tab: AreaTab }) {
  const access = useAccess();
  const open = AREA_TABS.filter((each) => access.mayCall(TAB_READS[each]));
  return (
    <Shell section="/areas" title={areas.title}>
      <div className={styles.screen}>
        <Tabs label={areas.title}>
          {open.map((each) => (
            <OpsLink key={each} className={TAB} to={areasPath(each)} current={each === tab}>
              {AREA_TAB_NAMES[each]}
            </OpsLink>
          ))}
        </Tabs>
        <Panel tab={tab} mayOpen={open.includes(tab)} />
      </div>
    </Shell>
  );
}
