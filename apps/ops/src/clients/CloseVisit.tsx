// Closing a visit by hand from the console, for work done whose record was lost with the technician's phone before it
// reached us. Ops say how it went, when the work began and ended on the visit's own day, and how they know
// (src/routes/ops/visit-changes.ts). No board draws it.

import { REASON_MAX_CHARS } from "@rules/policy/decision-reasons.ts";
import { boxError, type Failure } from "@maneman/web-kit/refusal";
import { Button } from "@maneman/ui/Button";
import { Drawer } from "@maneman/ui/Drawer";
import { ChoiceGroup, Field, Radio, TextArea, TextInput } from "@maneman/ui/Field";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useId, useState } from "react";
import { type HandClose } from "../api.ts";
import { clients, CLOSE } from "../content.ts";
import shared from "../components/visit-dialog.module.css";
import styles from "./close-visit.module.css";
import { FormRefusal } from "../components/Refusal.tsx";
import { clientsApi } from "./clients-api.ts";

const copy = clients.visits.handClose;

type Outcome = HandClose["outcome"];

const OUTCOMES: readonly Outcome[] = ["done", "partial", "no_show"];

/** "09:20" on an India date, as the instant the API takes. */
const instantOf = (date: string, time: string): string => new Date(`${date}T${time}:00+05:30`).toISOString();

/** A refusal in the console's words, a time the API refused said as the times are. */
const ERRORS = { ...copy.errors, started_at: copy.errors.times, ended_at: copy.errors.times };
const BOXES = ["started_at", "ended_at", "reason"];

function OutcomeChoice({ outcome, onChoose }: { outcome: Outcome; onChoose: (outcome: Outcome) => void }) {
  const id = useId();
  return (
    <ChoiceGroup className={styles.choices} legend={copy.outcome}>
      {OUTCOMES.map((each) => (
        <Radio
          key={each}
          label={copy.outcomes[each]}
          name={`${id}-outcome`}
          checked={outcome === each}
          onChange={() => {
            onChoose(each);
          }}
        />
      ))}
    </ChoiceGroup>
  );
}

interface ClosingProps {
  visitId: string;
  date: string;
  onClosed: (outcome: Outcome) => void;
}

function ClosingForm({ visitId, date, onClosed }: ClosingProps) {
  const [outcome, setOutcome] = useState<Outcome>("done");
  const [started, setStarted] = useState("");
  const [ended, setEnded] = useState("");
  const [reason, setReason] = useState("");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, once] = useOneAtATime();
  // A no-show's times are the technician's check-in and its wait.
  const timed = outcome !== "no_show";
  const ready = (!timed || (started !== "" && ended !== "")) && reason.trim() !== "";

  const close = () =>
    once(async () => {
      setFailure(null);
      const answer = await clientsApi.closeVisit(visitId, {
        outcome,
        ...(timed ? { started_at: instantOf(date, started), ended_at: instantOf(date, ended) } : {}),
        reason: reason.trim(),
      });
      if (answer.ok) onClosed(outcome);
      else setFailure({ code: answer.code, fields: answer.fields });
    });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void close();
      }}
    >
      <OutcomeChoice outcome={outcome} onChoose={setOutcome} />
      <div className={styles.times} hidden={!timed}>
        <Field className={shared.field} label={copy.started} error={boxError(ERRORS, failure, "started_at")}>
          {(control) => (
            <TextInput
              {...control}
              type="time"
              value={started}
              disabled={busy}
              onChange={(event) => {
                setStarted(event.target.value);
              }}
            />
          )}
        </Field>
        <Field className={shared.field} label={copy.ended} error={boxError(ERRORS, failure, "ended_at")}>
          {(control) => (
            <TextInput
              {...control}
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
      <Field className={shared.field} label={copy.reason} error={boxError(ERRORS, failure, "reason")}>
        {(control) => (
          <TextArea
            {...control}
            className={shared.reason}
            maxLength={REASON_MAX_CHARS}
            value={reason}
            disabled={busy}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        )}
      </Field>
      <div className={shared.actions}>
        <Button variant="primary" size="small" className={shared.primary} type="submit" busy={busy} disabled={!ready}>
          {busy ? copy.closing : copy.confirm}
        </Button>
      </div>
      <FormRefusal className={shared.error} errors={ERRORS} failure={failure} boxes={BOXES} />
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
    <Drawer titleId="close-visit-title" title={copy.title(name)} close={CLOSE} onDismiss={dismiss}>
      {closed === null ? (
        <ClosingForm visitId={visitId} date={date} onClosed={setClosed} />
      ) : (
        <p className={shared.done} role="status">
          {copy.done[closed]}
        </p>
      )}
    </Drawer>
  );
}
