// Switching a technician off, which signs them out and hands back their visits still to come, listed once it is done;
// and switching them back on (./TechnicianForms.tsx).

import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { Button, buttonLook } from "@maneman/ui/Button";
import { indiaClock, indiaDate, shortDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { type ReturnedVisit, type TechnicianSummary } from "../api.ts";
import { OpsLink } from "../components/Shell.tsx";
import { technicians } from "../content.ts";
import styles from "./technicians.module.css";
import { Refusal } from "../components/Refusal.tsx";
import { techniciansApi } from "./technicians-api.ts";
import { refusal } from "./refusal.ts";

export function SwitchOff({
  technician,
  onSwitchedOff,
}: {
  technician: TechnicianSummary;
  onSwitchedOff: (visits: readonly ReturnedVisit[]) => Promise<void>;
}) {
  const copy = technicians.switchOff;
  const [asking, setAsking] = useState(false);
  const [sending, once] = useOneAtATime();
  const [failed, setFailed] = useState<string | null>(null);

  const send = () =>
    once(async () => {
      setFailed(null);
      const answer = await techniciansApi.switchOff(technician.id);
      if (!answer.ok) {
        setFailed(refusal(answer.code));
        return;
      }
      await onSwitchedOff(answer.body.visits);
    });

  if (!asking) {
    return (
      <div className={styles.actions}>
        <Button
          variant="outline"
          size="small"
          className={styles.quiet}
          aria-label={copy.openLabel(technician.name)}
          onClick={() => {
            setAsking(true);
          }}
        >
          {copy.open}
        </Button>
      </div>
    );
  }
  return (
    <div className={styles.asking}>
      <p className={styles.warning}>{copy.warning(technician.visits_to_come)}</p>
      <div className={styles.actions}>
        <Button variant="danger" size="small" className={styles.revoke} disabled={sending} onClick={() => void send()}>
          {sending ? copy.sending : copy.confirm}
        </Button>
        <Button
          variant="outline"
          size="small"
          className={styles.quiet}
          disabled={sending}
          onClick={() => {
            setAsking(false);
          }}
        >
          {copy.cancel}
        </Button>
      </div>
      {failed !== null && <Refusal className={styles.error} said={failed} />}
    </div>
  );
}

export function SwitchOn({
  technician,
  onSwitchedOn,
}: {
  technician: TechnicianSummary;
  onSwitchedOn: () => Promise<void>;
}) {
  const copy = technicians.switchOn;
  const [sending, once] = useOneAtATime();
  const [failed, setFailed] = useState<string | null>(null);

  const send = () =>
    once(async () => {
      setFailed(null);
      const answer = await techniciansApi.switchOn(technician.id);
      if (!answer.ok) {
        // Their own number taken while they were off: the add form's words would read as if ops had typed it.
        setFailed(answer.code === "number_in_use" ? technicians.errors.number_in_use_now : refusal(answer.code));
        return;
      }
      await onSwitchedOn();
    });

  return (
    <>
      <div className={styles.actions}>
        <Button
          variant="outline"
          size="small"
          className={styles.quiet}
          aria-label={copy.openLabel(technician.name)}
          disabled={sending}
          onClick={() => void send()}
        >
          {sending ? copy.sending : copy.open}
        </Button>
      </div>
      {failed !== null && <Refusal className={styles.error} said={failed} />}
    </>
  );
}

/** The visits a technician just switched off no longer holds, with the way to give them to another. */
export function Returned({ visits }: { visits: readonly ReturnedVisit[] }) {
  const copy = technicians.switchOff;
  return (
    <div className={styles.stranded} role="status">
      <p className={styles.strandedTitle}>{copy.returned(visits.length)}</p>
      {visits.length > 0 && (
        <>
          <ul className={styles.leaveList}>
            {visits.map((visit) => (
              <li className={styles.leaveRow} key={visit.appointment_id}>
                {copy.visit(
                  `${shortDate(indiaDate(visit.starts_at))}, ${indiaClock(visit.starts_at)}`,
                  visit.client ?? copy.noClient,
                )}
              </li>
            ))}
          </ul>
          <OpsLink
            className={buttonLook({ variant: "outline", size: "small", className: styles.quiet })}
            to="/dispatch"
          >
            {copy.move}
          </OpsLink>
        </>
      )}
    </div>
  );
}
