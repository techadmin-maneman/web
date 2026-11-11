// Sending a landed step back to the visit's technician, with why, from the visit's story in its drawer
// (docs/decisions/0246-closed-and-sent-back.md). Their phone opens the step again and shows the reason. No board
// draws it.

import { REASON_MAX_CHARS } from "@rules/policy/decision-reasons.ts";
import { Button } from "@maneman/ui/Button";
import { CancelButton } from "@maneman/ui/CancelButton";
import { Field, TextArea } from "@maneman/ui/Field";
import { Refusal } from "@maneman/ui/Refusal";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { errorText } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { visitDialogStyles as styles } from "../clients/index.ts";
import { dispatch } from "../content.ts";
import { dispatchApi, type SentBackKind } from "./dispatch-api.ts";

const copy = dispatch.drawer.story.sendBack;

/** The reason and its Send back, beneath the step being sent back. */
export function SendBackForm({
  visitId,
  kind,
  onSent,
  onCancel,
}: {
  visitId: string;
  kind: SentBackKind;
  onSent: () => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, once] = useOneAtATime();

  const send = () =>
    once(async () => {
      setFailed(null);
      const answer = await dispatchApi.sendBack(visitId, kind, reason.trim());
      if (answer.ok) onSent();
      else setFailed(errorText(copy.errors, { code: answer.code }));
    });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void send();
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
        <CancelButton onClick={onCancel} />
      </div>
      {failed !== null && <Refusal className={styles.error} said={failed} />}
    </form>
  );
}
