// The waitlist, and marking a pincode live (Ops Console, board C3). Choosing a
// pincode asks the API what a launch would send, before anything is sent; only
// the second press launches it, which marks the pincode served and queues a
// WhatsApp to everyone on its list who asked to be told
// (docs/decisions/0048-referrals.md).

import { indiaDate, listDate } from "@maneman/web-kit/dates";
import { useCallback, useState } from "react";
import { api, type Area, type Launch } from "../api.ts";
import { Shell } from "../components/Shell.tsx";
import { BOOKING_URL, waitlist } from "../content.ts";
import { useLoad } from "../lib/useLoad.ts";
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

/** Each column, head and cells alike, at the board's own width, in waitlist.columns' order. */
const COLUMNS = [styles.pincode, styles.area, styles.count, styles.oldest, styles.referred, styles.alerts];

function LaunchPanel({
  launching,
  onCancel,
  onSend,
}: {
  launching: Launching;
  onCancel: () => void;
  onSend: () => void;
}) {
  const { area, preview, step } = launching;
  const copy = waitlist.launch;
  return (
    <section className={styles.launch} aria-labelledby="launch">
      <p className={styles.launchLabel} id="launch">
        {copy.label(area.pincode)}
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
      {step === "done" ? (
        <p className={styles.done} role="status">
          {copy.done(preview.alerts)}
        </p>
      ) : (
        <div className={styles.actions}>
          <button className={styles.send} type="button" disabled={step === "sending"} onClick={onSend}>
            {step === "sending" ? copy.sending : copy.send(preview.alerts)}
          </button>
          <button className={styles.quiet} type="button" onClick={onCancel}>
            {copy.cancel}
          </button>
        </div>
      )}
      {launching.code !== undefined && (
        <p className={styles.error} role="alert">
          {copy.errors[launching.code] ?? copy.errors.unknown}
        </p>
      )}
      <p className={styles.note}>{copy.note(preview.waiting - preview.alerts)}</p>
    </section>
  );
}

/**
 * One pincode. The board draws six columns and no button, so the pincode is
 * the control: choosing it asks what a launch would send. A pincode we already
 * come to cannot be launched again, and says so beside its area.
 */
function AreaRow({ area, thisYear, onChoose }: { area: Area; thisYear: number; onChoose: () => void }) {
  return (
    <tr>
      <th scope="row" className={styles.pincode}>
        {area.served ? (
          <span className={styles.plain}>{area.pincode}</span>
        ) : (
          <button
            className={styles.choose}
            type="button"
            aria-label={waitlist.choose(area.pincode, areaName(area))}
            onClick={onChoose}
          >
            {area.pincode}
          </button>
        )}
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

export function WaitlistScreen() {
  const [loaded, retry] = useLoad(api.waitlist);
  const [launching, setLaunching] = useState<Launching | null>(null);
  /** An error code from asking what a launch would send, before there is a panel to hold it. */
  const [refused, setRefused] = useState<string | null>(null);
  const thisYear = new Date().getFullYear();

  const choose = useCallback(async (area: Area) => {
    setRefused(null);
    const answer = await api.launch(area.pincode, false);
    if (answer.ok) setLaunching({ area, preview: answer.body, step: "asking" });
    else setRefused(answer.code);
  }, []);

  const send = useCallback(async () => {
    if (launching === null) return;
    setLaunching({ ...launching, step: "sending", code: undefined });
    const answer = await api.launch(launching.area.pincode, true);
    if (!answer.ok) {
      setLaunching({ ...launching, step: "asking", code: answer.code });
      return;
    }
    setLaunching({ ...launching, preview: answer.body, step: "done" });
    // The pincode is served now, so the table is read again and shows it live.
    retry();
  }, [launching, retry]);

  return (
    <Shell section="/waitlist" title={waitlist.title}>
      <div className={styles.column}>
        {refused !== null && (
          <p className={styles.error} role="alert">
            {waitlist.launch.errors[refused] ?? waitlist.launch.errors.unknown}
          </p>
        )}
        {loaded.state === "loading" ? (
          <Loading />
        ) : loaded.state === "failed" ? (
          <PanelFailed onRetry={retry} />
        ) : loaded.value.areas.length === 0 ? (
          <p className={styles.empty}>{waitlist.empty}</p>
        ) : (
          <section className={styles.panel}>
            <table className={styles.table}>
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
                {loaded.value.areas.map((area) => (
                  <AreaRow key={area.pincode} area={area} thisYear={thisYear} onChoose={() => void choose(area)} />
                ))}
              </tbody>
            </table>
            {loaded.value.more && <p className={styles.more}>{waitlist.more}</p>}
          </section>
        )}
        {launching !== null && (
          <LaunchPanel
            launching={launching}
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
