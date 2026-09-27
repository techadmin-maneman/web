// The waitlist, and marking a pincode live (Ops Console, board C3). Choosing a
// pincode asks the API what a launch would send, before anything is sent; only
// the second press launches it, which marks the pincode served and queues a
// WhatsApp to everyone on its list who asked to be told
// (docs/decisions/0048-referrals.md).
//
// A pincode already live can be chosen too: one served before Settings
// launched what it served left its waitlist untold, and this is how they are
// told (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).

import { Button } from "@maneman/ui/Button";
import { Table } from "@maneman/ui/Table";
import { useLoad, whenLoaded } from "@maneman/ui/useLoad";
import { indiaDate, listDate } from "@maneman/web-kit/dates";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Area, type Launch } from "../api.ts";
import { OpsLink, Shell } from "../components/Shell.tsx";
import { BOOKING_URL, waitlist } from "../content.ts";
import { settingsPath } from "../route.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import styles from "./waitlist.module.css";

const bookingUrl = BOOKING_URL[import.meta.env.MM_ENV] ?? BOOKING_URL.production ?? "";

/** Which pincode is being launched, what the API says it would send, and how that is going. */
type Launching = {
  readonly area: Area;
  readonly preview: Launch;
  readonly step: "asking" | "sending" | "done";
  readonly code?: string;
};

const areaName = (area: Area) => area.area ?? area.city ?? waitlist.unknown;

/** The pincode button's whole name: a launch for one still waiting, a telling for one already live. */
const chooseLabel = (area: Area) =>
  area.served ? waitlist.tell(area.pincode, areaName(area)) : waitlist.choose(area.pincode, areaName(area));

/** Each column, head and cells alike, at the board's own width, in waitlist.columns' order. */
const COLUMNS = [styles.pincode, styles.area, styles.count, styles.oldest, styles.referred, styles.alerts];

function LaunchPanel({
  launching,
  today,
  launchOn,
  onLaunchOn,
  onCancel,
  onSend,
}: {
  launching: Launching;
  /** India's date, the earliest a launch can be. */
  today: string;
  launchOn: string;
  onLaunchOn: (date: string) => void;
  onCancel: () => void;
  onSend: () => void;
}) {
  const { area, preview, step } = launching;
  const copy = waitlist.launch;
  const panel = useRef<HTMLElement>(null);
  // It opens beneath the list, so it is brought into view and read from its head (FEO-15).
  useEffect(() => {
    panel.current?.focus();
  }, [area.pincode]);
  const nothingToSend = area.served && preview.alerts === 0;
  return (
    <section className={styles.launch} aria-labelledby="launch" ref={panel} tabIndex={-1}>
      <p className={styles.launchLabel} id="launch">
        {area.served ? copy.tellLabel(area.pincode) : copy.label(area.pincode)}
      </p>
      <p className={styles.launchTitle}>{copy.title(preview.alerts)}</p>
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
      <p className={styles.message}>{copy.message(areaName(area), bookingUrl)}</p>
      <p className={styles.named}>
        {copy.named} <OpsLink to={settingsPath("area")}>{copy.rename}</OpsLink>
      </p>
      {!area.served && step !== "done" && (
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="launch-on">
            {copy.date}
          </label>
          <input
            className={styles.launchDate}
            id="launch-on"
            type="date"
            min={today}
            value={launchOn}
            aria-describedby="launch-on-hint"
            onChange={(event) => {
              onLaunchOn(event.target.value);
            }}
          />
          <p className={styles.fieldHint} id="launch-on-hint">
            {copy.dateHint}
          </p>
        </div>
      )}
      {step === "done" && (
        <p className={styles.done} role="status">
          {copy.done(preview.alerts)}
        </p>
      )}
      {step !== "done" && (
        <div className={styles.actions}>
          {!nothingToSend && (
            <Button
              variant="primary"
              size="small"
              className={styles.send}
              disabled={step === "sending" || launchOn === ""}
              onClick={onSend}
            >
              {step === "sending" ? copy.sending : copy.send(preview.alerts)}
            </Button>
          )}
          <Button variant="outline" size="small" className={styles.quiet} onClick={onCancel}>
            {copy.cancel}
          </Button>
        </div>
      )}
      {launching.code !== undefined && (
        <p className={styles.error} role="alert">
          {copy.errors[launching.code] ?? copy.errors.unknown}
        </p>
      )}
      <p className={styles.note}>{area.served ? copy.toldNote : copy.note(preview.waiting - preview.alerts)}</p>
    </section>
  );
}

/**
 * One pincode. The board draws six columns and no button, so the pincode is
 * the control: choosing it asks what a launch would send. A pincode we already
 * come to says so beside its area, and choosing it tells whoever there is still untold.
 */
function AreaRow({ area, thisYear, onChoose }: { area: Area; thisYear: number; onChoose: () => void }) {
  return (
    <tr>
      <th scope="row" className={styles.pincode}>
        <button className={styles.choose} type="button" aria-label={chooseLabel(area)} onClick={onChoose}>
          {area.pincode}
        </button>
      </th>
      <td className={styles.area}>
        {areaName(area)}
        {area.served && <span className={styles.live}>{waitlist.live}</span>}
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

/** Board C3's table: who waits where, the longest waits first; a line when nobody waits at all. */
function Pincodes({
  areas,
  more,
  thisYear,
  onChoose,
}: {
  areas: readonly Area[];
  more: boolean;
  thisYear: number;
  onChoose: (area: Area) => void;
}) {
  if (areas.length === 0) return <p className={styles.empty}>{waitlist.empty}</p>;
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
          {areas.map((area) => (
            <AreaRow
              key={area.pincode}
              area={area}
              thisYear={thisYear}
              onChoose={() => {
                onChoose(area);
              }}
            />
          ))}
        </tbody>
      </Table>
      {more && <p className={styles.more}>{waitlist.more}</p>}
    </section>
  );
}

export function WaitlistScreen() {
  const [loaded, retry] = useLoad(api.waitlist);
  const [launching, setLaunching] = useState<Launching | null>(null);
  /** An error code from asking what a launch would send, before there is a panel to hold it. */
  const [refused, setRefused] = useState<string | null>(null);
  const thisYear = new Date().getFullYear();
  const today = indiaDate(new Date().toISOString());
  const [launchOn, setLaunchOn] = useState(today);

  const choose = useCallback(
    async (area: Area) => {
      setRefused(null);
      setLaunchOn(today);
      const answer = await api.launch(area.pincode, false);
      if (answer.ok) setLaunching({ area, preview: answer.body, step: "asking" });
      else setRefused(answer.code);
    },
    [today],
  );

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
    <Shell section="/waitlist" title={waitlist.title}>
      <div className={styles.column}>
        {refused !== null && (
          <p className={styles.error} role="alert">
            {waitlist.launch.errors[refused] ?? waitlist.launch.errors.unknown}
          </p>
        )}
        {whenLoaded(loaded, {
          loading: <Loading />,
          failed: <PanelFailed onRetry={retry} />,
          loaded: ({ areas, more }) => (
            <Pincodes areas={areas} more={more} thisYear={thisYear} onChoose={(area) => void choose(area)} />
          ),
        })}
        {launching !== null && (
          <LaunchPanel
            launching={launching}
            today={today}
            launchOn={launchOn}
            onLaunchOn={setLaunchOn}
            onCancel={() => {
              setLaunching(null);
            }}
            onSend={() => void send()}
          />
        )}
      </div>
    </Shell>
  );
}
