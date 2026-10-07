// Letting a technician check in to one visit wherever the geofence puts them, as when the address's pin is a building's,
// far from its door (src/routes/ops/visit-changes.ts). Ops say why; the reason stays with the visit and is shown with a
// no-show's evidence. No board draws it.

import { REASON_MAX_CHARS } from "../../../../src/policy/decision-reasons.ts";
import { errorText } from "@maneman/web-kit/refusal";
import { Button } from "@maneman/ui/Button";
import { Dialog } from "@maneman/ui/Dialog";
import { Field, TextArea } from "@maneman/ui/Field";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useState } from "react";
import { api } from "../api.ts";
import styles from "../components/visit-dialog.module.css";
import { dispatch } from "../content.ts";

const copy = dispatch.letIn;

function Form({ visitId, onLetIn }: { visitId: string; onLetIn: () => void }) {
  const [reason, setReason] = useState("");
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, once] = useOneAtATime();

  const letIn = () =>
    once(async () => {
      setFailed(null);
      const answer = await api.letIn(visitId, reason.trim());
      if (answer.ok) onLetIn();
      else setFailed(errorText(copy.errors, { code: answer.code }));
    });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void letIn();
      }}
    >
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
        <Button
          variant="primary"
          size="small"
          className={styles.primary}
          type="submit"
          busy={busy}
          disabled={reason.trim() === ""}
        >
          {busy ? copy.sending : copy.confirm}
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

/** The panel ops let a technician check in from. Closing it says whether they did. */
export function LetIn({
  visitId,
  technician,
  onClose,
}: {
  visitId: string;
  technician: string;
  onClose: (letIn: boolean) => void;
}) {
  const [done, setDone] = useState(false);
  const dismiss = () => {
    onClose(done);
  };
  return (
    <Dialog className={styles.drawer} labelledBy="let-in-title" canClose onDismiss={dismiss}>
      <div className={styles.head}>
        <h2 className={styles.title} id="let-in-title">
          {copy.title(technician)}
        </h2>
        <Button variant="outline" size="small" className={styles.quiet} onClick={dismiss}>
          {copy.close}
        </Button>
      </div>
      <div className={styles.body}>
        {done ? (
          <p className={styles.done} role="status">
            {copy.done(technician)}
          </p>
        ) : (
          <Form
            visitId={visitId}
            onLetIn={() => {
              setDone(true);
            }}
          />
        )}
      </div>
    </Dialog>
  );
}
