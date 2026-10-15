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
  const titleId = useId();
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
        <Drawer
          titleId={titleId}
          title={copy.title}
          sub={copy.sub(`${subject}, ${dispatch.typeNames[due.kind]}`, rupees(due.amount))}
          canClose={!busy}
          onDismiss={close}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void record();
            }}
          >
            <Field label={copy.utr} error={failed ?? undefined}>
              {(control) => (
                <TextInput
                  {...control}
                  value={utr}
                  autoComplete="off"
                  inputMode="text"
                  onChange={(event) => {
                    setUtr(event.target.value);
                  }}
                />
              )}
            </Field>
            <span className={shared.acts}>
              <Button type="submit" variant="primary" size="small" disabled={busy || utr.trim() === ""}>
                {busy ? copy.recording : copy.record}
              </Button>
              <Button type="button" variant="outline" size="small" disabled={busy} onClick={close}>
                {copy.cancel}
              </Button>
            </span>
          </form>
        </Drawer>
      )}
    </>
  );
}
