// A technician's Phones tab: each phone he has logged in on, when it was last used, and whether it is signed in,
// signed out or revoked. Revoking a phone ends its session and makes it drop its cached jobs, so it asks before it
// sends (src/domain/technicians.ts).

import { Button } from "@maneman/ui/Button";
import { indiaClock, longDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { api, type Device, type Technician } from "../api.ts";
import { technicians } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import styles from "./technicians.module.css";

const copy = technicians.phones;

/** "Chrome on Android · 3f9a": what the browser said, and the end of the phone's own ID. */
const phoneName = (phone: Device) => copy.label(phone.label ?? copy.unlabelled, phone.device_id.slice(-4));

/** "22 Sep 2027, 10:30 am". */
const dateAndTime = (instant: string) => `${longDate(instant)}, ${indiaClock(instant)}`;

/** Where a revoke is: not asked for, asked about, sending, done here, or refused by the API. */
type Revoking =
  | { readonly step: "listed" }
  | { readonly step: "asking" }
  | { readonly step: "sending" }
  | { readonly step: "revoked"; readonly at: string }
  | { readonly step: "failed"; readonly code: string };

function PhoneState({ phone, revokedAt }: { phone: Device; revokedAt: string | null }) {
  if (revokedAt !== null) return <p className={styles.revoked}>{copy.revoked(longDate(revokedAt))}</p>;
  if (phone.signed_in) return <p className={styles.signedIn}>{copy.signedIn}</p>;
  return <p className={styles.revoked}>{copy.signedOut}</p>;
}

function Phone({ phone, technician }: { phone: Device; technician: Technician }) {
  const [revoking, setRevoking] = useState<Revoking>({ step: "listed" });
  const mayRevoke = useAccess().mayCall("POST /api/technicians/{id}/devices/{device}/revoke");
  const name = phoneName(phone);

  const revoke = async () => {
    setRevoking({ step: "sending" });
    const answer = await api.revokeDevice(technician.id, phone.device_id);
    if (answer.ok) setRevoking({ step: "revoked", at: answer.body.revoked_at });
    else setRevoking({ step: "failed", code: answer.code });
  };

  // The route's answer, else what it was when the roster was read.
  const revokedAt = revoking.step === "revoked" ? revoking.at : phone.revoked_at;
  const sending = revoking.step === "sending";
  const gone = revokedAt !== null;
  const asking = !gone && (revoking.step === "asking" || sending);
  const offered = mayRevoke && !gone && !asking;

  return (
    <li className={styles.phone}>
      <div className={styles.phoneLine}>
        <span className={styles.phoneName}>{name}</span>
        <span className={styles.seen}>{copy.seen(dateAndTime(phone.last_seen_at))}</span>
      </div>
      <PhoneState phone={phone} revokedAt={revokedAt} />
      {asking && (
        <div className={styles.asking}>
          <p className={styles.warning}>{copy.warning}</p>
          <div className={styles.actions}>
            <Button
              variant="danger"
              size="small"
              className={styles.revoke}
              disabled={sending}
              onClick={() => void revoke()}
            >
              {sending ? copy.revoking : copy.confirm}
            </Button>
            <Button
              variant="outline"
              size="small"
              className={styles.quiet}
              disabled={sending}
              onClick={() => {
                setRevoking({ step: "listed" });
              }}
            >
              {copy.cancel}
            </Button>
          </div>
        </div>
      )}
      {offered && (
        <div className={styles.actions}>
          <Button
            variant="outline"
            size="small"
            className={styles.quiet}
            aria-label={copy.revokeLabel(name, technician.name)}
            onClick={() => {
              setRevoking({ step: "asking" });
            }}
          >
            {copy.revoke}
          </Button>
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

export function Phones({ technician }: { technician: Technician }) {
  if (technician.devices.length === 0) return <p className={styles.none}>{copy.none}</p>;
  return (
    <ul className={styles.phoneList}>
      {technician.devices.map((phone) => (
        <Phone key={phone.device_id} phone={phone} technician={technician} />
      ))}
    </ul>
  );
}
