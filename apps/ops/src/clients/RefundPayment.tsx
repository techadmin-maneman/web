// A payment refunded by ops, with why: one the client made twice, as when they paid again for a fit owed to them
// (src/routes/ops/payment-refunds.ts). What is left of it goes back; the refund's row shows once Razorpay processes it.
// Offered beside each payment on a client's Payments tab and on the Ledger, which Finance reach without a client's page.

import { Button, RowButton } from "@maneman/ui/Button";
import { CancelButton } from "@maneman/ui/CancelButton";
import { FormActions } from "@maneman/ui/FormActions";
import { FormDrawer } from "@maneman/ui/FormDrawer";
import { Refusal } from "@maneman/ui/Refusal";
import { Field, TextInput } from "@maneman/ui/Field";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { rupees } from "@maneman/web-kit/money";
import { errorText } from "@maneman/web-kit/refusal";
import { useState } from "react";
import form from "@maneman/ui/forms.module.css";
import { clients } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import styles from "./clients.module.css";
import { clientsApi } from "./clients-api.ts";

const copy = clients.payments;

/** A payment as both lists carry it: what was paid, what has gone back, and whether it is captured yet. */
export interface Refundable {
  readonly id: string;
  readonly amount: number;
  readonly refunded_amount: number;
  readonly status: string;
}

/** Captured and not yet given back in full: the only payments a refund can be asked of. */
const refundable = (payment: Refundable) => payment.status !== "authorized" && payment.status !== "failed";

export function RefundPayment({ entry }: { entry: Refundable }) {
  const mayRefund = useAccess().mayCall("POST /api/payments/{id}/refund");
  const [open, setOpen] = useState(false);
  const [asked, setAsked] = useState<number | null>(null);
  if (asked !== null) {
    return (
      <span role="status" className={styles.closedLine}>
        {copy.refundAsked(rupees(asked))}
      </span>
    );
  }
  if (!refundable(entry) || !mayRefund) return null;
  const left = entry.amount - entry.refunded_amount;
  if (left <= 0) return null;
  const close = () => {
    setOpen(false);
  };
  return (
    <>
      <RowButton
        aria-label={copy.refundLabel(rupees(left))}
        onClick={() => {
          setOpen(true);
        }}
      >
        {copy.refundOpen}
      </RowButton>
      {open && (
        <FormDrawer title={copy.refundLabel(rupees(left))} onClose={close}>
          <RefundForm
            entry={entry}
            left={left}
            onAsked={(amount) => {
              setAsked(amount);
              close();
            }}
            onCancel={close}
          />
        </FormDrawer>
      )}
    </>
  );
}

/** Why the payment goes back, in a drawer beside the list, and the refund asked of Razorpay. */
function RefundForm(props: {
  entry: Refundable;
  left: number;
  onAsked: (amount: number) => void;
  onCancel: () => void;
}) {
  const { entry, left } = props;
  const [reason, setReason] = useState("");
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, once] = useOneAtATime();
  const refund = () =>
    once(async () => {
      setFailed(null);
      const answer = await clientsApi.refundPayment(entry.id, { reason: reason.trim() });
      if (answer.ok) props.onAsked(answer.body.amount);
      else setFailed(errorText(copy.refundErrors, answer));
    });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void refund();
      }}
    >
      <Field label={copy.refundReason} className={form.field}>
        {(control) => (
          <TextInput
            {...control}
            width="area"
            maxLength={200}
            value={reason}
            disabled={busy}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        )}
      </Field>
      {failed !== null && <Refusal said={failed} />}
      <FormActions>
        <Button variant="destructive" size="small" type="submit" busy={busy} disabled={reason.trim() === ""}>
          {copy.refundConfirm(rupees(left))}
        </Button>
        <CancelButton disabled={busy} onClick={props.onCancel} />
      </FormActions>
    </form>
  );
}
