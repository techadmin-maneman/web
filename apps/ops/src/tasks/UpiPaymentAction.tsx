// What ops do with a "UPI to record" task on the board itself: once the client's UPI payment is in the account, record
// it under its UTR, which closes the task and sends the client their receipt (docs/decisions/0208).

import { Button } from "@maneman/ui/Button";
import { Drawer } from "@maneman/ui/Drawer";
import { Field, TextInput } from "@maneman/ui/Field";
import { TextButton } from "@maneman/ui/TextLink";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { rupees } from "@maneman/web-kit/money";
import { errorText } from "@maneman/web-kit/refusal";
import { useId, useState } from "react";
import { type Task } from "../api.ts";
import { dispatch, tasks } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import shared from "./tasks.module.css";
import { tasksApi } from "./tasks-api.ts";

const copy = tasks.upi;

/** The drawer's one field, the UTR, and its two buttons. */
function UpiDrawer(props: {
  sub: string;
  utr: string;
  failed: string | null;
  busy: boolean;
  onUtr: (utr: string) => void;
  onRecord: () => void;
  onClose: () => void;
}) {
  const titleId = useId();
  return (
    <Drawer titleId={titleId} title={copy.title} sub={props.sub} canClose={!props.busy} onDismiss={props.onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          props.onRecord();
        }}
      >
        <Field label={copy.utr} error={props.failed ?? undefined}>
          {(control) => (
            <TextInput
              {...control}
              value={props.utr}
              autoComplete="off"
              onChange={(event) => {
                props.onUtr(event.target.value);
              }}
            />
          )}
        </Field>
        <span className={shared.acts}>
          <Button type="submit" variant="primary" size="small" disabled={props.busy || props.utr.trim() === ""}>
            {props.busy ? copy.recording : copy.record}
          </Button>
          <Button type="button" variant="outline" size="small" disabled={props.busy} onClick={props.onClose}>
            {copy.cancel}
          </Button>
        </span>
      </form>
    </Drawer>
  );
}

export function UpiPaymentAction({
  task,
  subject,
  onRecorded,
}: {
  task: Task;
  subject: string;
  onRecorded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [utr, setUtr] = useState("");
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, once] = useOneAtATime();
  const mayRecord = useAccess().mayCall("POST /api/visits/{id}/upi-payment");
  const due = task.facts.group === "upi_due" ? task.facts : null;
  if (due === null || !mayRecord) return null;

  const close = () => {
    setOpen(false);
    setUtr("");
    setFailed(null);
  };
  const record = () =>
    once(async () => {
      setFailed(null);
      const answer = await tasksApi.recordUpiPayment(task.id, utr.trim());
      if (answer.ok) {
        close();
        onRecorded();
      } else setFailed(errorText(copy.errors, { code: answer.code }));
    });

  return (
    <>
      <span className={shared.acts}>
        <TextButton
          tone="muted"
          compact
          onClick={() => {
            setOpen(true);
          }}
        >
          {copy.open}
          <VisuallyHidden>{` · ${subject}`}</VisuallyHidden>
        </TextButton>
      </span>
      {open && (
        <UpiDrawer
          sub={copy.sub(`${subject}, ${dispatch.typeNames[due.kind]}`, rupees(due.amount))}
          utr={utr}
          failed={failed}
          busy={busy}
          onUtr={setUtr}
          onRecord={() => void record()}
          onClose={close}
        />
      )}
    </>
  );
}
