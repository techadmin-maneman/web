// The client's alerts, at the right of their page, above staff's notes: what every technician reads in red before they
// start (docs/decisions/0242-client-record.md), each with who raised it and when, and taken off where it stands. Add,
// in the card's head, opens a drawer to raise one. A technician's raised at a visit's close shows with theirs.

import { Panel } from "@maneman/ui/Panel";
import { ALERT_MAX_CHARS } from "@rules/policy/client-record.ts";
import { plainDate } from "@maneman/web-kit/plain-date";
import { PanelFailed } from "@maneman/ui/States";
import { AddForm } from "@maneman/ui/AddForm";
import { RowButton } from "@maneman/ui/Button";
import { EmptyState } from "@maneman/ui/EmptyState";
import { Field, TextArea } from "@maneman/ui/Field";
import { FormDrawer } from "@maneman/ui/FormDrawer";
import { TextButton } from "@maneman/ui/TextLink";
import { Toast } from "@maneman/ui/Toast";
import { useLoad, whenLoaded } from "@maneman/ui/useLoad";
import { todayInIndia } from "@maneman/web-kit/dates";
import { errorText } from "@maneman/web-kit/refusal";
import { useCallback, useRef, useState } from "react";
import { Refusal } from "@maneman/ui/Refusal";
import type { components } from "../api-schema.ts";
import { clients } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { staffName } from "../lib/who.ts";
import form from "@maneman/ui/forms.module.css";
import styles from "./clients.module.css";
import { clientsApi } from "./clients-api.ts";

const copy = clients.alerts;

type Alert = components["schemas"]["ClientAlert"];

/** Who raised it: a member of staff by name, or a technician at a visit. */
const raisedBy = (alert: Alert): string =>
  alert.raised_by.kind === "staff" ? staffName(alert.raised_by.staff) : copy.atVisit(alert.raised_by.name);

/** The drawer's form an alert is written in, with Add alert and Cancel; an empty one is refused on its box. */
function AlertForm(props: { clientId: string; onAdded: (alerts: readonly Alert[]) => void; onCancel: () => void }) {
  const [body, setBody] = useState("");
  return (
    <AddForm
      title={copy.formTitle}
      words={{ add: copy.save }}
      errors={copy.errors}
      boxes={["body"]}
      send={() => clientsApi.raiseClientAlert(props.clientId, body.trim())}
      onAdded={(read) => {
        props.onAdded(read.alerts);
      }}
      onCancel={props.onCancel}
    >
      <div className={form.fields}>
        <Field label={copy.label} className={form.field} box="body">
          {(control) => (
            <TextArea
              {...control}
              autoFocus
              rows={3}
              value={body}
              maxLength={ALERT_MAX_CHARS}
              onChange={(event) => {
                setBody(event.currentTarget.value);
              }}
            />
          )}
        </Field>
      </div>
    </AddForm>
  );
}

function AlertList(props: {
  clientId: string;
  initial: readonly Alert[];
  mayWrite: boolean;
  adding: boolean;
  onAdded: () => void;
  onCancel: () => void;
}) {
  const { clientId, mayWrite } = props;
  const [alerts, setAlerts] = useState(props.initial);
  const [takeOffRefused, setTakeOffRefused] = useState<string | null>(null);
  // An alert that stays on is read in red before every visit, so a take-off that failed says so.
  const takeOff = async (alert: string) => {
    const answer = await clientsApi.takeOffClientAlert(clientId, alert);
    setTakeOffRefused(answer.ok ? null : errorText(copy.errors, answer));
    if (answer.ok) setAlerts(answer.body.alerts);
  };
  return (
    <>
      {alerts.length === 0 && <EmptyState look="panel" line={copy.none} />}
      <ul className={styles.notes}>
        {alerts.map((alert) => (
          <li key={alert.id} className={styles.noteItem}>
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
      {takeOffRefused !== null && (
        <div className={styles.addNote}>
          <Refusal said={takeOffRefused} />
        </div>
      )}
      {props.adding && (
        <FormDrawer title={copy.formTitle} onClose={props.onCancel}>
          <AlertForm
            clientId={clientId}
            onAdded={(read) => {
              setAlerts(read);
              props.onAdded();
            }}
            onCancel={props.onCancel}
          />
        </FormDrawer>
      )}
    </>
  );
}

function Strip({ clientId }: { clientId: string }) {
  const load = useCallback(() => clientsApi.clientAlerts(clientId), [clientId]);
  const [loaded, retry] = useLoad(load);
  const mayWrite = useAccess().mayCall("POST /api/clients/{id}/alerts");
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  // The drawer closed, the keyboard goes back to Add.
  const stop = () => {
    setAdding(false);
    requestAnimationFrame(() => opener.current?.focus());
  };
  return (
    <Panel
      titleId="client-alerts"
      title={copy.title}
      actions={
        mayWrite &&
        loaded.state === "loaded" && (
          <TextButton
            compact
            ref={opener}
            aria-label={copy.add}
            onClick={() => {
              setAdded(false);
              setAdding(true);
            }}
          >
            {copy.open}
          </TextButton>
        )
      }
    >
      {whenLoaded(loaded, {
        loading: null,
        failed: <PanelFailed onRetry={retry} requestId={loaded.state === "failed" ? loaded.requestId : null} />,
        loaded: (read) => (
          <AlertList
            clientId={clientId}
            initial={read.alerts}
            mayWrite={mayWrite}
            adding={adding}
            onAdded={() => {
              setAdded(true);
              stop();
            }}
            onCancel={stop}
          />
        ),
      })}
      {added && <Toast>{copy.added}</Toast>}
    </Panel>
  );
}

export function ClientAlerts({ clientId }: { clientId: string }) {
  const mayRead = useAccess().mayCall("GET /api/clients/{id}/alerts");
  return mayRead ? <Strip clientId={clientId} /> : null;
}
