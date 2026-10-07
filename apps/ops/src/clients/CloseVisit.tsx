// Closing a visit by hand from the console, for work done whose record was lost with the technician's phone before it
// reached us. Ops say how it went, when the work began and ended on the visit's own day, and how they know
// (src/routes/ops/visit-changes.ts). No board draws it.

import { REASON_MAX_CHARS } from "../../../../src/policy/decision-reasons.ts";
import { errorText } from "@maneman/web-kit/refusal";
import { Button } from "@maneman/ui/Button";
import { Dialog } from "@maneman/ui/Dialog";
import { Field, TextArea, TextInput } from "@maneman/ui/Field";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useId, useState } from "react";
import { api, type HandClose } from "../api.ts";
import { clients } from "../content.ts";
import styles from "../components/visit-dialog.module.css";

const copy = clients.visits.handClose;

type Outcome = HandClose["outcome"];

const OUTCOMES: readonly Outcome[] = ["done", "partial"];

/** "09:20" on an India date, as the instant the API takes. */
const instantOf = (date: string, time: string): string => new Date(`${date}T${time}:00+05:30`).toISOString();

/** A refusal in the console's words: a field the API named, else its code. */
function closeRefusal(code: string, fields: readonly string[]): string {
  if (code === "invalid_request" && fields.includes("reason")) return copy.errors.reason ?? "";
  if (code === "invalid_request") return copy.errors.times ?? "";
  return errorText(copy.errors, { code });
}

function OutcomeChoice({ outcome, onChoose }: { outcome: Outcome; onChoose: (outcome: Outcome) => void }) {
  const id = useId();
  return (
    <fieldset className={styles.choices}>
      <legend className={styles.legend}>{copy.outcome}</legend>
      {OUTCOMES.map((each) => (
        <div className={styles.choice} key={each}>
          <input
            type="radio"
            id={`${id}-${each}`}
            name={`${id}-outcome`}
            checked={outcome === each}
            onChange={() => {
              onChoose(each);
            }}
          />
          <label htmlFor={`${id}-${each}`}>{copy.outcomes[each]}</label>
        </div>
      ))}
    </fieldset>
  );
}

function Form({ visitId, date, onClosed }: { visitId: string; date: string; onClosed: (outcome: Outcome) => void }) {
  const [outcome, setOutcome] = useState<Outcome>("done");
  const [started, setStarted] = useState("");
  const [ended, setEnded] = useState("");
  const [reason, setReason] = useState("");
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, once] = useOneAtATime();
  const ready = started !== "" && ended !== "" && reason.trim() !== "";

  const close = () =>
    once(async () => {
      setFailed(null);
      const answer = await api.closeVisit(visitId, {
        outcome,
        started_at: instantOf(date, started),
        ended_at: instantOf(date, ended),
        reason: reason.trim(),
      });
      if (answer.ok) onClosed(outcome);
      else setFailed(closeRefusal(answer.code, answer.fields));
    });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void close();
      }}
    >
      <OutcomeChoice outcome={outcome} onChoose={setOutcome} />
      <div className={styles.times}>
        <Field className={styles.field} label={copy.started}>
          {(control) => (
            <TextInput
              {...control}
              className={styles.text}
              type="time"
              value={started}
              disabled={busy}
              onChange={(event) => {
                setStarted(event.target.value);
              }}
            />
          )}
        </Field>
        <Field className={styles.field} label={copy.ended}>
          {(control) => (
            <TextInput
              {...control}
              className={styles.text}
              type="time"
              value={ended}
              disabled={busy}
              onChange={(event) => {
                setEnded(event.target.value);
              }}
            />
          )}
        </Field>
      </div>
      <Field className={styles.field} label={copy.reason}>
        {(control) => (
          <TextArea
            {...control}
            className={styles.reason}
            maxLength={REASON_MAX_CHARS}
            value={reason}
            disabled={busy}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        )}
      </Field>
      <div className={styles.actions}>
        <Button variant="primary" size="small" className={styles.primary} type="submit" busy={busy} disabled={!ready}>
          {busy ? copy.closing : copy.confirm}
        </Button>
      </div>
      {failed !== null && (
        <p className={styles.error} role="alert">
          {failed}
        </p>
      )}
    </form>
  );
}

/** The panel ops close one visit by hand in. Closing the panel says whether the visit was closed. */
export function CloseVisit({
  visitId,
  name,
  date,
  onClose,
}: {
  visitId: string;
  name: string;
  /** The visit's India date, which the times are on. */
  date: string;
  onClose: (closed: boolean) => void;
}) {
  const [closed, setClosed] = useState<Outcome | null>(null);
  const dismiss = () => {
    onClose(closed !== null);
  };
  return (
    <Dialog className={styles.drawer} labelledBy="close-visit-title" canClose onDismiss={dismiss}>
      <div className={styles.head}>
        <h2 className={styles.title} id="close-visit-title">
          {copy.title(name)}
        </h2>
        <Button variant="outline" size="small" className={styles.quiet} onClick={dismiss}>
          {copy.close}
        </Button>
      </div>
      <div className={styles.body}>
        {closed === null ? (
          <Form visitId={visitId} date={date} onClosed={setClosed} />
        ) : (
          <p className={styles.done} role="status">
            {copy.done[closed]}
          </p>
        )}
      </div>
    </Dialog>
  );
}
