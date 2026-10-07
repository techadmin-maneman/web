// One technician's page: their details, then their week, leave, phones and kit, a tab at a time, so covering a sick
// technician or a lost phone happens in one place. The roster is read once for the page; the Leave and Kit tabs read
// what they show as they open. A technician switched off has no phone signed in and no leave to record, so their page
// is their details alone.

import { buttonLook } from "@maneman/ui/Button";
import { Tabs, TAB } from "@maneman/ui/Tabs";
import { failedRequestId, useLoad } from "@maneman/ui/useLoad";
import { useState } from "react";
import { api, type ReturnedVisit, type Roster, type Technician, type TechnicianSummary } from "../api.ts";
import { OpsLink, Shell } from "../components/Shell.tsx";
import { technicians } from "../content.ts";
import {
  dispatchPath,
  go,
  TECHNICIAN_TAB_NAMES,
  TECHNICIAN_TABS,
  technicianPath,
  type TechnicianTab,
} from "../route.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { Details, Returned } from "./TechnicianForms.tsx";
import { Kit } from "./TechnicianKit.tsx";
import { Leave } from "./TechnicianLeave.tsx";
import { Phones } from "./TechnicianPhones.tsx";
import styles from "./technicians.module.css";

/** A technician as the roster carries them, with their phones while they are active. */
interface Entry {
  readonly summary: TechnicianSummary;
  readonly active: Technician | null;
}

function entryOf(book: Roster, id: string): Entry | null {
  const active = book.technicians.find((technician) => technician.id === id);
  if (active !== undefined) return { summary: active, active };
  const off = book.switched_off.find((technician) => technician.id === id);
  if (off === undefined) return null;
  return { summary: off, active: null };
}

/** What the last switch on this page did, said until the page is left. */
type Switched = { readonly to: "off"; readonly visits: readonly ReturnedVisit[] } | { readonly to: "on" };

function Week({ technician }: { technician: TechnicianSummary }) {
  return (
    <>
      <div className={styles.actions}>
        <OpsLink
          className={buttonLook({ variant: "outline", size: "small", className: styles.quiet })}
          to={dispatchPath({ find: technician.name })}
        >
          {technicians.week.open}
        </OpsLink>
      </div>
    </>
  );
}

function TabPanel({ tab, technician }: { tab: TechnicianTab; technician: Technician }) {
  if (tab === "leave") return <Leave technician={technician} />;
  if (tab === "phones") return <Phones technician={technician} />;
  if (tab === "kit") return <Kit technician={technician} />;
  return <Week technician={technician} />;
}

function TechnicianTabs({ technician, tab }: { technician: Technician; tab: TechnicianTab }) {
  return (
    <>
      <Tabs className={styles.tabs} label={technicians.page.tabsLabel(technician.name)}>
        {TECHNICIAN_TABS.map((each) => (
          <OpsLink key={each} className={TAB} to={technicianPath(technician.id, each)} current={each === tab}>
            {TECHNICIAN_TAB_NAMES[each]}
          </OpsLink>
        ))}
      </Tabs>
      <section className={styles.tabPanel} aria-label={TECHNICIAN_TAB_NAMES[tab]}>
        <TabPanel tab={tab} technician={technician} />
      </section>
    </>
  );
}

function TechnicianPage({
  entry,
  cities,
  tab,
  onChange,
}: {
  entry: Entry;
  cities: readonly string[];
  tab: TechnicianTab;
  onChange: () => Promise<void>;
}) {
  const { summary, active } = entry;
  const [switched, setSwitched] = useState<Switched | null>(null);
  return (
    <div className={styles.page}>
      <OpsLink className={styles.back} to="/technicians">
        {technicians.page.back}
      </OpsLink>
      <h2 className={styles.pageTitle}>{summary.name}</h2>
      <Details
        technician={summary}
        cities={cities}
        active={active !== null}
        onChange={onChange}
        onSwitchedOff={async (visits) => {
          setSwitched({ to: "off", visits });
          await onChange();
        }}
        onSwitchedOn={async () => {
          setSwitched({ to: "on" });
          await onChange();
        }}
        onDeleted={() => {
          go("/technicians");
        }}
      />
      {switched?.to === "off" && <Returned visits={switched.visits} />}
      {switched?.to === "on" && (
        <p className={styles.notice} role="status">
          {technicians.switchOn.done(summary.name)}
        </p>
      )}
      {active !== null && <TechnicianTabs technician={active} tab={tab} />}
    </div>
  );
}

function NotOnRoster() {
  return (
    <div className={styles.page}>
      <p className={styles.empty}>{technicians.page.notFound}</p>
      <OpsLink className={styles.back} to="/technicians">
        {technicians.page.back}
      </OpsLink>
    </div>
  );
}

export function TechnicianScreen({ technicianId, tab }: { technicianId: string; tab: TechnicianTab }) {
  const [loaded, retry] = useLoad(api.technicians);
  // The roster as read again after a change on this page.
  const [fresh, setFresh] = useState<Roster | null>(null);

  const readAgain = async () => {
    const answer = await api.technicians();
    if (answer.ok) setFresh(answer.body);
  };

  const page = () => {
    if (loaded.state === "loading") return <Loading />;
    if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={failedRequestId(loaded)} />;
    const book = fresh ?? loaded.value;
    const entry = entryOf(book, technicianId);
    if (entry === null) return <NotOnRoster />;
    return <TechnicianPage entry={entry} cities={book.cities} tab={tab} onChange={readAgain} />;
  };

  return (
    <Shell section="/technicians" title={technicians.title}>
      {page()}
    </Shell>
  );
}
