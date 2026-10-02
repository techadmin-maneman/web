// A discount code at the pay step (docs/decisions/0108-discount-codes.md), which no board draws: a quiet link opens
// a box, and a code that applies prices the hold again, the code taken off before GST, so Checkout's order is made for
// what is left. A code that does not apply is told only that. Once the client taps pay, Checkout has its order and the
// code can no longer change, so the box is shut while the sheet is busy.

import { Button } from "@maneman/ui/Button";
import { useState } from "react";
import { api, type Hold } from "../api.ts";
import { booking } from "../content.ts";
import { amountOff } from "../lib/money.ts";
import styles from "./booking.module.css";

const copy = booking.pay.code;

const said = (code: string): string => copy.errors[code] ?? copy.errors.unknown ?? "";

export function CodeBox(props: {
  hold: Hold;
  busy: boolean;
  onHold: (hold: Hold) => void;
  /** True while a code is being applied or taken off, when the price may change and Pay must wait. */
  onSending: (sending: boolean) => void;
}) {
  const { hold, busy, onHold } = props;
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const applied = hold.discount;

  const send = (going: boolean) => {
    setSending(going);
    props.onSending(going);
  };

  const apply = async () => {
    send(true);
    setProblem(null);
    const answer = await api.enterCode(hold.id, typed.trim());
    send(false);
    if (!answer.ok) {
      setProblem(said(answer.code));
      return;
    }
    setTyped("");
    setOpen(false);
    onHold(answer.body);
  };

  const remove = async () => {
    send(true);
    setProblem(null);
    const answer = await api.removeCode(hold.id);
    send(false);
    if (!answer.ok) {
      setProblem(said(answer.code));
      return;
    }
    onHold(answer.body);
  };

  const shown = problem !== null && (
    <p className={styles.problem} role="alert">
      {problem}
    </p>
  );

  if (applied !== null) {
    return (
      <div className={styles.code}>
        {applied.list_price !== null && (
          <p className={styles.codeApplied}>{copy.applied(applied.code, amountOff(applied.list_price, hold.price))}</p>
        )}
        <button className={styles.codeLink} type="button" disabled={busy || sending} onClick={() => void remove()}>
          {sending ? copy.removing : copy.remove}
        </button>
        {shown}
      </div>
    );
  }

  if (!open) {
    return (
      <div className={styles.code}>
        <button
          className={styles.codeLink}
          type="button"
          disabled={busy}
          onClick={() => {
            setOpen(true);
          }}
        >
          {copy.open}
        </button>
      </div>
    );
  }

  return (
    <form
      className={styles.code}
      onSubmit={(event) => {
        event.preventDefault();
        void apply();
      }}
    >
      <label className={styles.label} htmlFor="discount-code">
        {copy.label}
      </label>
      <div className={styles.codeRow}>
        <input
          id="discount-code"
          className={styles.codeInput}
          type="text"
          autoCapitalize="characters"
          autoComplete="off"
          value={typed}
          onChange={(event) => {
            setTyped(event.target.value);
            setProblem(null);
          }}
        />
        <Button type="submit" variant="outline" size="control" disabled={busy || sending || typed.trim() === ""}>
          {sending ? copy.applying : copy.apply}
        </Button>
      </div>
      {shown}
    </form>
  );
}
