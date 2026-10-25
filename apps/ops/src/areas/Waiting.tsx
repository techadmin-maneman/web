// The Waitlist: who waits in each pincode, longest first. Choosing one shows what launching it would send, and
// only the panel's press serves it and messages its waitlist (docs/decisions/0048-referrals.md). A pincode already live
// can be chosen too, for a waitlist a launch from Settings left untold
// (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).

import { NextToOpen } from "./Demand.tsx";
import { EmptyState } from "@maneman/ui/EmptyState";
import { TextButton } from "@maneman/ui/TextLink";
import { Field, DateInput } from "@maneman/ui/Field";
import { useFocusOnMount } from "@maneman/ui/useFocusOnMount";
import { errorText } from "@maneman/web-kit/refusal";
import { capsLook } from "@maneman/ui/Caps";
import { Table } from "@maneman/ui/Table";
import { failedRequestId, useLoad, whenLoaded } from "@maneman/ui/useLoad";
import { indiaDate, listDate, todayInIndia, yearInIndia } from "@maneman/web-kit/dates";
import { useCallback, useState } from "react";
import { type Area, type Launch, type ServedPincode } from "../api.ts";
import { OpsLink } from "../components/Shell.tsx";
import { areas, waitlist } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { settingsPath } from "../route.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { Narrowing, SortHeads, TableEnd } from "../components/TableTools.tsx";
import { useTableView, type Column } from "../components/useTableView.ts";
import { AddPincode } from "./AddPincode.tsx";
import shared from "./areas.module.css";
import styles from "./waiting.module.css";
import { LaunchPanel } from "./LaunchPanel.tsx";
import { Refusal } from "../components/Refusal.tsx";
import { areasApi } from "./areas-api.ts";

const copy = areas.launch;

/** Which pincode is being launched, what the API says it would send, and how that is going. */
type Launching = {
  readonly area: Area;
  readonly preview: Launch;
  readonly step: "asking" | "sending" | "done";
  readonly code?: string;
};

const areaName = (area: Area) => area.area ?? area.city ?? waitlist.unknown;

/** Whether the service area holds the pincode: one it does not is in no city until it is added. */
const isHeld = (area: Area) => area.city !== null;

/** The pincode button's whole name: an add for one we do not hold, a launch, or a telling for one already live. */
function chooseLabel(area: Area): string {
  if (!isHeld(area)) return waitlist.add(area.pincode);
  if (area.served) return waitlist.tell(area.pincode, areaName(area));
  return waitlist.choose(area.pincode, areaName(area));
}

/** The launch date a panel opens on: the one the pincode holds, where that is past, else today. */
function openingLaunchDay(area: Area, today: string): string {
  if (area.launched_at === null) return today;
  const held = indiaDate(area.launched_at);
  return held < today ? held : today;
}

interface LaunchingProps {
  readonly launching: Launching;
  /** India's date, the latest a launch can be dated. */
  readonly today: string;
  readonly launchOn: string;
  /** Whether their access reaches Served, where the area is named. */
  readonly mayRename: boolean;
  readonly onLaunchOn: (date: string) => void;
  readonly onCancel: () => void;
  readonly onSend: () => void;
}

/** The launch panel for one pincode: its figures, where its name comes from, and the day it starts. */
function LaunchOne({ launching, today, launchOn, mayRename, onLaunchOn, onCancel, onSend }: LaunchingProps) {
  const { area, preview, step } = launching;
  const nothingToSend = area.served && preview.alerts === 0;
  return (
    <LaunchPanel
      label={area.served ? copy.tellLabel(area.pincode) : copy.label(area.pincode)}
      alerts={preview.alerts}
      area={areaName(area)}
      sendLabel={nothingToSend ? null : copy.send(preview.alerts)}
      ready={launchOn !== "" && launchOn <= today}
      sending={step === "sending"}
      done={step === "done" ? copy.done(preview.alerts) : null}
      error={launching.code === undefined ? null : errorText(copy.errors, { code: launching.code })}
      note={area.served ? null : copy.note(preview.waiting - preview.alerts)}
      onSend={onSend}
      onCancel={onCancel}
    >
      <dl className={shared.figures}>
        <div className={shared.figureRow}>
          <dt>{copy.rows.waiting}</dt>
          <dd>{preview.waiting}</dd>
        </div>
        <div className={shared.figureRow}>
          <dt>{copy.rows.alerts}</dt>
          <dd>{preview.alerts}</dd>
        </div>
        <div className={shared.figureRow}>
          <dt>{copy.rows.referred}</dt>
          <dd>{area.referred}</dd>
        </div>
      </dl>
      {mayRename && (
        <p className={shared.named}>
          <OpsLink to={settingsPath("areas")}>{waitlist.rename}</OpsLink>
        </p>
      )}
      {!area.served && step !== "done" && (
        <Field label={waitlist.date} className={shared.field}>
          {(control) => (
            <DateInput
              {...control}
              className={shared.launchDate}
              max={today}
              value={launchOn}
              onChange={(event) => {
                onLaunchOn(event.target.value);
              }}
            />
          )}
        </Field>
      )}
    </LaunchPanel>
  );
}

/** The panel for a pincode the service area does not hold: it is added, then marked live as any other. */
function AddPanel({
  area,
  cities,
  onAdded,
  onCancel,
}: {
  area: Area;
  cities: readonly string[];
  onAdded: (added: ServedPincode) => void;
  onCancel: () => void;
}) {
  const panel = useFocusOnMount<HTMLElement>();
  return (
    <section className={shared.launch} aria-labelledby="add" ref={panel} tabIndex={-1}>
      <p className={capsLook(shared.launchLabel)} id="add">
        {areas.add.label(area.pincode)}
      </p>
      <AddPincode pincode={area.pincode} cities={cities} onAdded={onAdded} onCancel={onCancel} />
    </section>
  );
}

/**
 * One pincode. The board draws six columns and no button, so the pincode is
 * the control: choosing it asks what a launch would send, or adds a pincode we
 * do not hold. A pincode we already come to says so beside its area. For a
 * person whose access does not reach a launch, it is only the pincode.
 */
function AreaRow({ area, thisYear, onChoose }: { area: Area; thisYear: number; onChoose: (() => void) | null }) {
  return (
    <tr>
      <th scope="row" className={shared.pincode}>
        {onChoose === null ? (
          area.pincode
        ) : (
          <TextButton tone="muted" compact aria-label={chooseLabel(area)} onClick={onChoose}>
            {area.pincode}
          </TextButton>
        )}
      </th>
      <td className={shared.area}>
        {isHeld(area) ? areaName(area) : <span className={shared.notHeld}>{waitlist.notHeld}</span>}
        {area.served && <span className={capsLook(shared.live)}>{waitlist.live}</span>}
      </td>
      <td className={shared.count}>{area.waiting}</td>
      <td className={shared.oldest}>
        {area.oldest === null ? waitlist.unknown : listDate(indiaDate(area.oldest), thisYear)}
      </td>
      <td className={shared.referred}>{area.referred}</td>
      <td className={shared.alerts}>{area.alerts}</td>
    </tr>
  );
}

/** The waitlist's table: who waits where, the longest waits first; a line when nobody waits at all. */
function Pincodes({
  areas: listed,
  more,
  thisYear,
  chooserFor,
}: {
  areas: readonly Area[];
  more: boolean;
  thisYear: number;
  /** What choosing a pincode does, or null where their access reaches nothing to do with it. */
  chooserFor: (area: Area) => (() => void) | null;
}) {
  const [pin, name, waiting, oldest, referred, alerts] = waitlist.columns;
  const columns: readonly Column<Area>[] = [
    { label: pin, sort: (row) => row.pincode, className: shared.pincode },
    { label: name, sort: areaName, className: shared.area },
    { label: waiting, sort: (row) => row.waiting, className: shared.count },
    { label: oldest, sort: (row) => row.oldest ?? "", className: shared.oldest },
    { label: referred, sort: (row) => row.referred, className: shared.referred },
    { label: alerts, sort: (row) => row.alerts, className: shared.alerts },
  ];
  const view = useTableView(listed, columns, { search: (row) => `${row.pincode} ${areaName(row)}` });
  if (listed.length === 0) return <EmptyState look="panel" line={waitlist.empty} />;
  return (
    <section className={shared.panel}>
      <Narrowing view={view} label={waitlist.narrow} className={styles.narrow} />
      <Table className={shared.table}>
        <thead>
          <tr>
            <SortHeads view={view} />
          </tr>
        </thead>
        <tbody>
          {view.shown.map((area) => (
            <AreaRow key={area.pincode} area={area} thisYear={thisYear} onChoose={chooserFor(area)} />
          ))}
        </tbody>
      </Table>
      <TableEnd view={view} />
      {more && <p className={shared.more}>{waitlist.more}</p>}
    </section>
  );
}

export function Waiting() {
  const [loaded, retry] = useLoad(areasApi.waitlist);
  const [launching, setLaunching] = useState<Launching | null>(null);
  const [adding, setAdding] = useState<Area | null>(null);
  /** An error code from asking what a launch would send, before there is a panel to hold it. */
  const [refused, setRefused] = useState<string | null>(null);
  const thisYear = yearInIndia(Date.now());
  const today = todayInIndia(Date.now());
  const [launchOn, setLaunchOn] = useState(today);
  const access = useAccess();
  const mayLaunch = access.mayCall("POST /api/pincodes/{pin}/launch");
  const mayAdd = mayLaunch && access.mayCall("POST /api/pincodes");
  // A launch is kept to the caller's cities, while the service area is set nationally.
  const mayRename = access.mayCall("POST /api/service-area");

  const preview = useCallback(
    async (area: Area) => {
      setRefused(null);
      setLaunchOn(openingLaunchDay(area, today));
      const answer = await areasApi.launch(area.pincode, false);
      if (answer.ok) setLaunching({ area, preview: answer.body, step: "asking" });
      else setRefused(answer.code);
    },
    [today],
  );

  const chooserFor = (area: Area): (() => void) | null => {
    if (isHeld(area) && mayLaunch) {
      return () => {
        setAdding(null);
        setLaunching(null);
        void preview(area);
      };
    }
    if (!isHeld(area) && mayAdd) {
      return () => {
        setLaunching(null);
        setRefused(null);
        setAdding(area);
      };
    }
    return null;
  };

  const added = (area: Area, held: ServedPincode) => {
    setAdding(null);
    // The table is read again, so the pincode shows the area and city it has now.
    retry();
    void preview({ ...area, area: held.area, city: held.city, served: held.served });
  };

  const send = useCallback(async () => {
    if (launching === null) return;
    setLaunching({ ...launching, step: "sending", code: undefined });
    // Today is left to the API, whose day it is; only a day ops chose is sent.
    const answer = await areasApi.launch(launching.area.pincode, true, launchOn === today ? null : launchOn);
    if (!answer.ok) {
      setLaunching({ ...launching, step: "asking", code: answer.code });
      return;
    }
    setLaunching({ ...launching, preview: answer.body, step: "done" });
    // The pincode is served now, so the table is read again and shows it live.
    retry();
  }, [launching, launchOn, today, retry]);

  return (
    <div className={shared.column}>
      {refused !== null && <Refusal className={shared.error} said={errorText(copy.errors, { code: refused })} />}
      {whenLoaded(loaded, {
        loading: <Loading />,
        failed: <PanelFailed onRetry={retry} requestId={failedRequestId(loaded)} />,
        loaded: (list) => (
          <>
            <Pincodes areas={list.areas} more={list.more} thisYear={thisYear} chooserFor={chooserFor} />
            {adding !== null && (
              <AddPanel
                key={adding.pincode}
                area={adding}
                cities={list.cities}
                onAdded={(held) => {
                  added(adding, held);
                }}
                onCancel={() => {
                  setAdding(null);
                }}
              />
            )}
          </>
        ),
      })}
      {launching !== null && (
        <LaunchOne
          key={launching.area.pincode}
          launching={launching}
          today={today}
          launchOn={launchOn}
          mayRename={mayRename}
          onLaunchOn={setLaunchOn}
          onCancel={() => {
            setLaunching(null);
          }}
          onSend={() => void send()}
        />
      )}
    </div>
  );
}

/** The waitlist page: who waits where, then the pincodes to open next (ADR 0224). */
export function WaitlistPage() {
  return (
    <div className={shared.column}>
      <Waiting />
      <NextToOpen />
    </div>
  );
}
