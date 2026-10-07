// Areas' Waiting tab: who waits in each pincode, the longest wait first. Choosing a pincode asks the API
// what marking it live would send, before anything is sent; only the panel's press launches it, which serves the
// pincode and queues a WhatsApp to everyone on its list who asked to be told (docs/decisions/0048-referrals.md).
//
// A pincode already live can be chosen too: one served before a launch from Settings told its waitlist left them
// untold, and this is how they are told (docs/decisions/0071-what-ops-see-before-a-setting-changes.md). A pincode
// the service area does not hold is added first, with its area's name and its city.

import { useFocusOnMount } from "@maneman/ui/useFocusOnMount";
import { errorText } from "@maneman/web-kit/refusal";
import { capsLook } from "@maneman/ui/Caps";
import { Table } from "@maneman/ui/Table";
import { failedRequestId, useLoad, whenLoaded } from "@maneman/ui/useLoad";
import { indiaDate, listDate, yearInIndia } from "@maneman/web-kit/dates";
import { useCallback, useState } from "react";
import { api, type Area, type Launch, type ServedPincode } from "../api.ts";
import { OpsLink } from "../components/Shell.tsx";
import { areas, waitlist } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { areasPath } from "../route.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { AddPincode } from "./AddPincode.tsx";
import styles from "./areas.module.css";
import { LaunchPanel } from "./LaunchPanel.tsx";

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

/** Each column, head and cells alike, at the board's own width, in waitlist.columns' order. */
const COLUMNS = [styles.pincode, styles.area, styles.count, styles.oldest, styles.referred, styles.alerts];

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
      <dl className={styles.figures}>
        <div className={styles.figureRow}>
          <dt>{copy.rows.waiting}</dt>
          <dd>{preview.waiting}</dd>
        </div>
        <div className={styles.figureRow}>
          <dt>{copy.rows.alerts}</dt>
          <dd>{preview.alerts}</dd>
        </div>
        <div className={styles.figureRow}>
          <dt>{copy.rows.referred}</dt>
          <dd>{area.referred}</dd>
        </div>
      </dl>
      {mayRename && (
        <p className={styles.named}>
          <OpsLink to={areasPath("served")}>{waitlist.rename}</OpsLink>
        </p>
      )}
      {!area.served && step !== "done" && (
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="launch-on">
            {waitlist.date}
          </label>
          <input
            className={styles.launchDate}
            id="launch-on"
            type="date"
            max={today}
            value={launchOn}
            onChange={(event) => {
              onLaunchOn(event.target.value);
            }}
          />
        </div>
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
    <section className={styles.launch} aria-labelledby="add" ref={panel} tabIndex={-1}>
      <p className={capsLook(styles.launchLabel)} id="add">
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
      <th scope="row" className={styles.pincode}>
        {onChoose === null ? (
          area.pincode
        ) : (
          <button className={styles.choose} type="button" aria-label={chooseLabel(area)} onClick={onChoose}>
            {area.pincode}
          </button>
        )}
      </th>
      <td className={styles.area}>
        {isHeld(area) ? areaName(area) : <span className={styles.notHeld}>{waitlist.notHeld}</span>}
        {area.served && <span className={capsLook(styles.live)}>{waitlist.live}</span>}
      </td>
      <td className={styles.count}>{area.waiting}</td>
      <td className={styles.oldest}>
        {area.oldest === null ? waitlist.unknown : listDate(indiaDate(area.oldest), thisYear)}
      </td>
      <td className={styles.referred}>{area.referred}</td>
      <td className={styles.alerts}>{area.alerts}</td>
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
  if (listed.length === 0) return <p className={styles.empty}>{waitlist.empty}</p>;
  return (
    <section className={styles.panel}>
      <Table className={styles.table}>
        <thead>
          <tr>
            {waitlist.columns.map((column, index) => (
              <th key={column} scope="col" className={COLUMNS[index]}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {listed.map((area) => (
            <AreaRow key={area.pincode} area={area} thisYear={thisYear} onChoose={chooserFor(area)} />
          ))}
        </tbody>
      </Table>
      {more && <p className={styles.more}>{waitlist.more}</p>}
    </section>
  );
}

export function Waiting() {
  const [loaded, retry] = useLoad(api.waitlist);
  const [launching, setLaunching] = useState<Launching | null>(null);
  const [adding, setAdding] = useState<Area | null>(null);
  /** An error code from asking what a launch would send, before there is a panel to hold it. */
  const [refused, setRefused] = useState<string | null>(null);
  const thisYear = yearInIndia(Date.now());
  const today = indiaDate(new Date().toISOString());
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
      const answer = await api.launch(area.pincode, false);
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
    const answer = await api.launch(launching.area.pincode, true, launchOn === today ? null : launchOn);
    if (!answer.ok) {
      setLaunching({ ...launching, step: "asking", code: answer.code });
      return;
    }
    setLaunching({ ...launching, preview: answer.body, step: "done" });
    // The pincode is served now, so the table is read again and shows it live.
    retry();
  }, [launching, launchOn, today, retry]);

  return (
    <div className={styles.column}>
      {refused !== null && (
        <p className={styles.error} role="alert">
          {errorText(copy.errors, { code: refused })}
        </p>
      )}
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
