// One technician's page: their head with Call and their details behind Edit details, their figures, then their week,
// hours, leave, phones and kit, a tab at a time, so covering a sick technician or a lost phone happens in one place. The roster is read once for the page; the Leave and Kit tabs read
// what they show as they open. A technician switched off has no phone signed in and no leave to record, so their page
// is their details alone.

import { EmptyState } from "@maneman/ui/EmptyState";
import { Panel } from "@maneman/ui/Panel";
import { Toast } from "@maneman/ui/Toast";
import { Tabs, TAB } from "@maneman/ui/Tabs";
import { failedRequestId, useLoad } from "@maneman/ui/useLoad";
import { useState } from "react";
import { type ReturnedVisit, type Roster, type Technician, type TechnicianSummary } from "../api.ts";
import { OpsLink } from "../frame/Shell.tsx";
import { technicians } from "../content.ts";
import { go, TECHNICIAN_TAB_NAMES, TECHNICIAN_TABS, technicianPath, type TechnicianTab } from "../route.ts";
import { PanelLoading, PanelFailed } from "@maneman/ui/States";
import { Details } from "./TechnicianForms.tsx";
import { TechnicianFigures, TechnicianHead, useBelowZero } from "./TechnicianHead.tsx";
import { Badge } from "@maneman/ui/Badge";
import { PageTitle } from "@maneman/ui/PageHeader";
import { Returned } from "./TechnicianSwitch.tsx";
import { Kit } from "./TechnicianKit.tsx";
import { Hours } from "./TechnicianHours.tsx";
import { Leave } from "./TechnicianLeave.tsx";
import { Phones } from "./TechnicianPhones.tsx";
import { TechnicianWeek } from "./TechnicianWeek.tsx";
import styles from "./technicians.module.css";
import { techniciansApi } from "./technicians-api.ts";

/** A technician as the roster carries them, with their phones while they are active. */
interface Entry {
  readonly summary: TechnicianSummary;
  readonly active: Technician | null;
}

function entryOf(roster: Roster, id: string): Entry | null {
  const active = roster.technicians.find((technician) => technician.id === id);
  if (active !== undefined) return { summary: active, active };
  const off = roster.switched_off.find((technician) => technician.id === id);
  if (off === undefined) return null;
  return { summary: off, active: null };
}

/** What the last switch on this page did, said until the page is left. */
type Switched = { readonly to: "off"; readonly visits: readonly ReturnedVisit[] } | { readonly to: "on" };

function TabPanel({
  tab,
  technician,
  everyone,
  onChange,
}: {
  tab: TechnicianTab;
  technician: Technician;
  /** Everyone's reach from Settings, for the Hours tab. */
  everyone: number;
  onChange: () => Promise<void>;
}) {
  if (tab === "hours") return <Hours technician={technician} everyone={everyone} onChange={onChange} />;
  if (tab === "leave") return <Leave technician={technician} />;
  if (tab === "phones") return <Phones technician={technician} />;
  if (tab === "kit") return <Kit technician={technician} />;
  return <TechnicianWeek technician={technician} />;
}

function TechnicianTabs({
  technician,
  tab,
  belowZero,
  everyone,
  onChange,
}: {
  technician: Technician;
  tab: TechnicianTab;
  everyone: number;
  /** How many kit items are below zero, counted on the Kit tab's name. */
  belowZero: number | null;
  onChange: () => Promise<void>;
}) {
  return (
    <>
      <Tabs className={styles.tabs} label={technicians.page.tabsLabel(technician.name)}>
        {TECHNICIAN_TABS.map((each) => (
          <OpsLink key={each} className={TAB} to={technicianPath(technician.id, each)} current={each === tab}>
            {TECHNICIAN_TAB_NAMES[each]}
            {each === "kit" && belowZero !== null && belowZero > 0 && (
              <Badge tone="error" className={styles.tabCount}>
                {belowZero}
              </Badge>
            )}
          </OpsLink>
        ))}
      </Tabs>
      {/* A tab's panel titled as the tab reads its title, and does not show it again. */}
      <PageTitle.Provider value={TECHNICIAN_TAB_NAMES[tab]}>
        {tab === "kit" ? (
          <TabPanel tab={tab} technician={technician} everyone={everyone} onChange={onChange} />
        ) : (
          <Panel titleId="technician-tab" title={TECHNICIAN_TAB_NAMES[tab]}>
            <div className={tab === "hours" ? undefined : styles.tabBody}>
              <TabPanel tab={tab} technician={technician} everyone={everyone} onChange={onChange} />
            </div>
          </Panel>
        )}
      </PageTitle.Provider>
    </>
  );
}

function TechnicianPage({
  entry,
  cities,
  everyone,
  tab,
  onChange,
}: {
  entry: Entry;
  cities: readonly string[];
  /** Everyone's reach from Settings, which the roster carries. */
  everyone: number;
  tab: TechnicianTab;
  onChange: () => Promise<void>;
}) {
  const { summary, active } = entry;
  const [switched, setSwitched] = useState<Switched | null>(null);
  const belowZero = useBelowZero(summary.id);
  return (
    <div className={styles.page}>
      <TechnicianHead
        summary={summary}
        active={active}
        details={(close) => (
          <Details
            technician={summary}
            cities={cities}
            active={active !== null}
            onChange={onChange}
            onSwitchedOff={async (visits) => {
              // The drawer shuts, so the page says what went back on the board.
              close();
              setSwitched({ to: "off", visits });
              await onChange();
            }}
            onSwitchedOn={async () => {
              close();
              setSwitched({ to: "on" });
              await onChange();
            }}
            onDeleted={() => {
              go("/technicians");
            }}
          />
        )}
      />
      {switched?.to === "off" && <Returned visits={switched.visits} />}
      {switched?.to === "on" && <Toast>{technicians.switchOn.done(summary.name)}</Toast>}
      {active !== null && <TechnicianFigures summary={summary} belowZero={belowZero} />}
      {active !== null && (
        <TechnicianTabs technician={active} tab={tab} belowZero={belowZero} everyone={everyone} onChange={onChange} />
      )}
    </div>
  );
}

function NotOnRoster() {
  return (
    <div className={styles.page}>
      <EmptyState look="panel" line={technicians.page.notFound} />
      <OpsLink className={styles.back} to="/technicians">
        {technicians.page.back}
      </OpsLink>
    </div>
  );
}

export function TechnicianScreen({ technicianId, tab }: { technicianId: string; tab: TechnicianTab }) {
  const [loaded, retry] = useLoad(techniciansApi.technicians);
  // The roster as read again after a change on this page.
  const [fresh, setFresh] = useState<Roster | null>(null);

  const readAgain = async () => {
    const answer = await techniciansApi.technicians();
    if (answer.ok) setFresh(answer.body);
  };

  const page = () => {
    if (loaded.state === "loading") return <PanelLoading />;
    if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={failedRequestId(loaded)} />;
    const roster = fresh ?? loaded.value;
    const entry = entryOf(roster, technicianId);
    if (entry === null) return <NotOnRoster />;
    return (
      <TechnicianPage
        entry={entry}
        cities={roster.cities}
        everyone={roster.default_reach_min}
        tab={tab}
        onChange={readAgain}
      />
    );
  };

  return <>{page()}</>;
}
