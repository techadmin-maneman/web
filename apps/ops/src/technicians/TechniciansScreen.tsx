// Technicians (Ops Console, board D3): who works, their zone, the jobs they
// have finished and how those ran, and the phones they have logged in on.
// Revoking a phone ends its session and makes it drop its cached jobs, so it
// asks before it sends (src/domain/technicians.ts).
//
// The board's fifth column is Skill, and nothing records what a technician is
// trained for, so it is not drawn and a line beneath the table says why
// (docs/open-points.md, item 59).

import { fullDate, longDate } from "@maneman/web-kit/dates";
import { Fragment, useState } from "react";
import { api, type Device, type Technician, type TechnicianWork } from "../api.ts";
import { Shell } from "../components/Shell.tsx";
import { technicians } from "../content.ts";
import { useLoad } from "../lib/useLoad.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import styles from "./technicians.module.css";

/** The route's period ends the day after the last one counted; the note names that last day. */
const lastDay = (exclusiveEnd: string) =>
  new Date(Date.parse(`${exclusiveEnd}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/**
 * How long the technician's visits took, on average. A technician the phone
 * timed none of reads as a gap, never as a nought: the jobs were done and
 * nothing timed them. One who runs over the length their visits were planned
 * for reads in brass, as the board letters its own long average.
 */
function Service({ figures }: { figures: TechnicianWork | undefined }) {
  const copy = technicians.work;
  const average = figures?.average_minutes ?? null;
  const planned = figures?.average_planned_minutes ?? null;
  if (figures === undefined || average === null || planned === null) {
    return <span className={styles.none}>{technicians.unknown}</span>;
  }

  return (
    <>
      <span className={average - planned >= copy.overBy ? styles.over : undefined}>
        {copy.average(Math.floor(average / 60), average % 60)}
      </span>
      {/* The average is of the jobs the phone timed, so it says so when that is not all of them. */}
      {figures.timed_jobs < figures.jobs && (
        <span className={styles.base}>{copy.base(figures.timed_jobs, figures.jobs)}</span>
      )}
    </>
  );
}

/** Where a phone is: listed, asked about, sending, revoked here, or refused by the API. */
type Revoking =
  | { readonly step: "listed" }
  | { readonly step: "asking" }
  | { readonly step: "sending" }
  | { readonly step: "revoked"; readonly at: string }
  | { readonly step: "failed"; readonly code: string };

function Phone({ phone, technician }: { phone: Device; technician: Technician }) {
  const [revoking, setRevoking] = useState<Revoking>({ step: "listed" });
  const copy = technicians.phones;
  const name = phone.label ?? copy.unlabelled;

  const revoke = async () => {
    setRevoking({ step: "sending" });
    const answer = await api.revokeDevice(technician.id, phone.device_id);
    if (answer.ok) setRevoking({ step: "revoked", at: answer.body.revoked_at });
    else setRevoking({ step: "failed", code: answer.code });
  };

  // The route's answer, else what it was when the roster was read.
  const revokedAt = revoking.step === "revoked" ? revoking.at : phone.revoked_at;
  const sending = revoking.step === "sending";
  // A phone is offered, then asked about, then gone: one of the three at a time.
  const gone = revokedAt !== null;
  const asking = !gone && (revoking.step === "asking" || sending);
  const offered = !gone && !asking;

  return (
    <li className={styles.phone}>
      <div className={styles.phoneLine}>
        <span className={styles.phoneName}>{name}</span>
        <span className={styles.seen}>{copy.seen(longDate(phone.last_seen_at))}</span>
      </div>
      {revokedAt !== null && <p className={styles.revoked}>{copy.revoked(longDate(revokedAt))}</p>}
      {asking && (
        <div className={styles.asking}>
          <p className={styles.warning}>{copy.warning}</p>
          <div className={styles.actions}>
            <button className={styles.revoke} type="button" disabled={sending} onClick={() => void revoke()}>
              {sending ? copy.revoking : copy.confirm}
            </button>
            <button
              className={styles.quiet}
              type="button"
              disabled={sending}
              onClick={() => {
                setRevoking({ step: "listed" });
              }}
            >
              {copy.cancel}
            </button>
          </div>
        </div>
      )}
      {offered && (
        <div className={styles.actions}>
          <button
            className={styles.quiet}
            type="button"
            aria-label={copy.revokeLabel(name, technician.name)}
            onClick={() => {
              setRevoking({ step: "asking" });
            }}
          >
            {copy.revoke}
          </button>
        </div>
      )}
      {revoking.step === "failed" && (
        <p className={styles.error} role="alert">
          {copy.errors[revoking.code] ?? copy.errors.unknown}
        </p>
      )}
    </li>
  );
}

function Roster() {
  const [loaded, retry] = useLoad(api.technicians);
  // The roster carries no period, so the figures are a read of their own; the
  // table is one table either way, and waits for both.
  const [work, retryWork] = useLoad(api.technicianWork);

  if (loaded.state === "loading" || work.state === "loading") return <Loading />;
  if (loaded.state === "failed" || work.state === "failed") {
    return (
      <PanelFailed
        onRetry={() => {
          retry();
          retryWork();
        }}
      />
    );
  }

  const figures = new Map(work.value.technicians.map((each) => [each.technician_id, each]));
  return (
    <section className={styles.panel} aria-labelledby="roster">
      <h2 className={styles.hiddenTitle} id="roster">
        {technicians.title}
      </h2>
      {loaded.value.technicians.length === 0 ? (
        <p className={styles.empty}>{technicians.empty}</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              {technicians.columns.map((column) => (
                <th key={column} scope="col" className={styles.head}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loaded.value.technicians.map((technician) => (
              <Fragment key={technician.id}>
                <tr>
                  <th scope="row" className={styles.name}>
                    {technician.name}
                  </th>
                  <td className={styles.zone}>{technician.zone ?? technicians.unknown}</td>
                  <td className={styles.jobs}>{figures.get(technician.id)?.jobs ?? technicians.unknown}</td>
                  <td className={styles.service}>
                    <Service figures={figures.get(technician.id)} />
                  </td>
                </tr>
                {/* The board's row has no room for the phones, so they sit beneath the name. */}
                <tr>
                  <td className={styles.phones} colSpan={technicians.columns.length}>
                    {technician.devices.length === 0 ? (
                      <span className={styles.none}>{technicians.phones.none}</span>
                    ) : (
                      <ul className={styles.phoneList}>
                        {technician.devices.map((phone) => (
                          <Phone key={phone.device_id} phone={phone} technician={technician} />
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
      <p className={styles.note}>
        {technicians.work.period(fullDate(work.value.from), fullDate(lastDay(work.value.to)))}
      </p>
      <p className={styles.note}>{technicians.work.skill}</p>
    </section>
  );
}

export function TechniciansScreen() {
  return (
    <Shell section="/technicians" title={technicians.title}>
      <div className={styles.column}>
        <Roster />
      </div>
    </Shell>
  );
}
