// A payment refunded by ops, with why: one the client made twice, as when they paid again for a fit owed to them
// (src/routes/ops/payment-refunds.ts). What is left of it goes back; the refund's row shows once Razorpay processes it.

import { Button } from "@maneman/ui/Button";
import { Field, TextInput } from "@maneman/ui/Field";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { rupees } from "@maneman/web-kit/money";
import { errorText } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { client, type ClientPayment } from "../api.ts";
import { clients } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import styles from "./clients.module.css";

const copy = clients.payments;

type Paid = Extract<ClientPayment, { kind: "payment" }>;

export function RefundPayment({ entry }: { entry: ClientPayment }) {
  const mayRefund = useAccess().mayCall("POST /api/payments/{id}/refund");
  const [open, setOpen] = useState(false);
  if (entry.kind !== "payment" || entry.status === "authorized" || !mayRefund) return null;
  const left = entry.amount - entry.refunded_amount;
  if (left <= 0) return null;
  if (!open) {
    return (
      <Button
        variant="outline"
        size="small"
        aria-label={copy.refundLabel(rupees(left))}
        onClick={() => {
          setOpen(true);
        }}
      >
        {copy.refundOpen}
      </Button>
    );
  }
  return <RefundForm entry={entry} left={left} />;
}

function RefundForm({ entry, left }: { entry: Paid; left: number }) {
  const [reason, setReason] = useState("");
  const [asked, setAsked] = useState<number | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, once] = useOneAtATime();
  if (asked !== null) {
    return (
      <span role="status" className={styles.closedLine}>
        {copy.refundAsked(rupees(asked))}
      </span>
    );
  }
  const refund = () =>
    once(async () => {
      setFailed(null);
      const answer = await client.post("/api/payments/{id}/refund", {
        path: { id: entry.id },
        body: { reason: reason.trim() },
      });
      if (answer.ok) setAsked(answer.body.amount);
      else setFailed(errorText(copy.refundErrors, answer));
    });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void refund();
      }}
    >
      <Field label={copy.refundReason}>
        {(control) => (
          <TextInput
            {...control}
            maxLength={200}
            value={reason}
            disabled={busy}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        )}
      </Field>
      <Button variant="destructive" size="small" type="submit" busy={busy} disabled={reason.trim() === ""}>
        {copy.refundConfirm(rupees(left))}
      </Button>
      {failed !== null && <p role="alert">{failed}</p>}
    </form>
  );
}
