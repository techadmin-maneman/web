// Technicians (Ops Console, board D3): who works, their zone, and the phones
// they have logged in on. Revoking a phone ends its session and makes it drop
// its cached jobs, so it asks before it sends (src/domain/technicians.ts).
//
// The board draws Jobs, Avg service and Skill beside the name; nothing gives
// them, so the table carries the two columns the route answers and the phones
// the board does not draw (docs/open-points.md, item 59).

import { longDate } from "@maneman/web-kit/dates";
import { Fragment, useState } from "react";
import { api, type Device, type Technician } from "../api.ts";
import { Shell } from "../components/Shell.tsx";
import { technicians } from "../content.ts";
import { useLoad } from "../lib/useLoad.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import styles from "./technicians.module.css";

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

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} />;

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
