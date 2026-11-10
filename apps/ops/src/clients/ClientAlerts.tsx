// The client's alerts, at the right of their page, above staff's notes: what every technician reads in red before they
// start (docs/decisions/0242-client-record.md), each with who raised it and when, taken off where it stands, and a box
// beneath to raise one. A technician's raised at a visit's close shows with theirs.

import { classes } from "@maneman/ui/classes";
import { Panel } from "@maneman/ui/Panel";
import { ALERT_MAX_CHARS } from "@rules/policy/client-record.ts";
import { plainDate } from "@maneman/web-kit/plain-date";
import { PanelFailed } from "@maneman/ui/States";
import { Button, RowButton } from "@maneman/ui/Button";
import { Field, TextArea } from "@maneman/ui/Field";
import { useLoad, whenLoaded } from "@maneman/ui/useLoad";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { todayInIndia } from "@maneman/web-kit/dates";
import { errorText } from "@maneman/web-kit/refusal";
import { useCallback, useState } from "react";
import { Refusal } from "@maneman/ui/Refusal";
import type { components } from "../api-schema.ts";
import { clients } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { staffName } from "../lib/who.ts";
import styles from "./clients.module.css";
import { clientsApi } from "./clients-api.ts";

const copy = clients.alerts;

type Alert = components["schemas"]["ClientAlert"];

/** Who raised it: a member of staff by name, or a technician at a visit. */
const raisedBy = (alert: Alert): string =>
  alert.raised_by.kind === "staff" ? staffName(alert.raised_by.staff) : copy.atVisit(alert.raised_by.name);

/** The box beneath the alerts a new one is written in; Save shows once there is something to save. */
function AddAlert({ onSave }: { onSave: (body: string) => Promise<string | null> }) {
  const [body, setBody] = useState("");
  const [refused, setRefused] = useState<string | null>(null);
  const [busy, once] = useOneAtATime();
  const save = () =>
    once(async () => {
      const said = await onSave(body.trim());
      setRefused(said);
      if (said === null) setBody("");
    });
  return (
    <div className={classes(styles.noteForm, styles.addNote)}>
      <Field label={copy.add} labelHidden>
        {(control) => (
          <TextArea
            {...control}
            rows={1}
            placeholder={copy.add}
            value={body}
            maxLength={ALERT_MAX_CHARS}
            onChange={(event) => {
              setBody(event.currentTarget.value);
            }}
          />
        )}
      </Field>
      {refused !== null && <Refusal said={refused} />}
      {body.trim() !== "" && (
        <div className={styles.noteActions}>
          <Button variant="primary" size="small" disabled={busy} onClick={() => void save()}>
            {busy ? copy.saving : copy.save}
          </Button>
        </div>
      )}
    </div>
  );
}

function AlertList({ clientId, initial }: { clientId: string; initial: readonly Alert[] }) {
  const mayWrite = useAccess().mayCall("POST /api/clients/{id}/alerts");
  const [alerts, setAlerts] = useState(initial);
  const raise = async (body: string) => {
    const answer = await clientsApi.raiseClientAlert(clientId, body);
    if (!answer.ok) return errorText(copy.errors, answer);
    setAlerts(answer.body.alerts);
    return null;
  };
  const takeOff = async (alert: string) => {
    const answer = await clientsApi.takeOffClientAlert(clientId, alert);
    if (answer.ok) setAlerts(answer.body.alerts);
  };
  return (
    <>
      {alerts.length === 0 && !mayWrite && <p className={styles.openNone}>{copy.none}</p>}
      <ul className={styles.notes}>
        {alerts.map((alert) => (
          <li key={alert.id} className={styles.note}>
            <p className={styles.noteBody}>{alert.body}</p>
            <span className={styles.noteBy}>
              {copy.by(raisedBy(alert), plainDate(todayInIndia(Date.parse(alert.written_at))))}
            </span>
            {mayWrite && (
              <span className={styles.noteActions}>
                <RowButton onClick={() => void takeOff(alert.id)}>{copy.takeOff}</RowButton>
              </span>
            )}
          </li>
        ))}
      </ul>
      {mayWrite && <AddAlert onSave={raise} />}
    </>
  );
}

function Strip({ clientId }: { clientId: string }) {
  const load = useCallback(() => clientsApi.clientAlerts(clientId), [clientId]);
  const [loaded, retry] = useLoad(load);
  return (
    <Panel titleId="client-alerts" title={copy.title}>
      {whenLoaded(loaded, {
        loading: null,
        failed: <PanelFailed onRetry={retry} requestId={loaded.state === "failed" ? loaded.requestId : null} />,
        loaded: (read) => <AlertList clientId={clientId} initial={read.alerts} />,
      })}
    </Panel>
  );
}

export function ClientAlerts({ clientId }: { clientId: string }) {
  const mayRead = useAccess().mayCall("GET /api/clients/{id}/alerts");
  return mayRead ? <Strip clientId={clientId} /> : null;
}
