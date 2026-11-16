// A discount code at the pay step (docs/decisions/0108-discount-codes.md): a quiet link opens
// a box, and a code that applies prices the hold again, the code taken off before GST, so Checkout's order is made for
// what is left. A code that does not apply is told only that. The box is shut while the sheet is busy paying; once
// Checkout is closed unpaid, the code may change again, and the next Pay makes a new order for the new price.

import { Field, TextInput } from "@maneman/ui/Field";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { TextButton } from "@maneman/ui/TextLink";
import { capsLook } from "@maneman/ui/Caps";
import { Button } from "@maneman/ui/Button";
import { useEffect, useState, type ReactNode } from "react";
import { api, type Hold } from "../api.ts";
import { describedBy, Missing } from "@maneman/ui/Missing";
import { booking, missing } from "../content.ts";
import { amountOff } from "../lib/money.ts";
import shared from "./booking.module.css";
import styles from "./code-box.module.css";

const copy = booking.pay.code;

const said = (code: string): string => copy.errors[code] ?? copy.errors.unknown ?? "";

/** A code on the hold: what it took off, and the way to take it off again. */
function Applied(props: {
  hold: Hold;
  applied: NonNullable<Hold["discount"]>;
  busy: boolean;
  removing: boolean;
  onRemove: () => void;
  children: ReactNode;
}) {
  const { applied } = props;
  return (
    <div className={styles.code}>
      {applied.list_price !== null && (
        <p className={styles.codeApplied}>
          {copy.applied(applied.code, amountOff(applied.list_price, props.hold.price))}
        </p>
      )}
      <TextButton tone="muted" disabled={props.busy} onClick={props.onRemove}>
        {props.removing ? copy.removing : copy.remove}
      </TextButton>
      {props.children}
    </div>
  );
}

/** The box: the code as typed, and Apply beside it, waiting for a code, with what is missing beneath. */
function CodeForm(props: {
  typed: string;
  problem: string | null;
  held: boolean;
  sending: boolean;
  onTyped: (typed: string) => void;
  onApply: () => void;
}) {
  const empty = props.typed.trim() === "";
  return (
    <form
      className={styles.code}
      onSubmit={(event) => {
        event.preventDefault();
        props.onApply();
      }}
    >
      <Field
        label={copy.label}
        error={props.problem}
        announce
        look={{ label: capsLook(shared.label), error: shared.problem }}
      >
        {(control) => (
          <div className={styles.codeRow}>
            <TextInput
              {...control}
              className={styles.codeInput}
              autoCapitalize="characters"
              autoComplete="off"
              value={props.typed}
              onChange={(event) => {
                props.onTyped(event.target.value);
              }}
            />
            <Button
              type="submit"
              variant="outline"
              size="control"
              disabled={props.held || empty}
              aria-describedby={describedBy("discount-code", empty)}
            >
              {props.sending ? copy.applying : copy.apply}
            </Button>
          </div>
        )}
      </Field>
      <Missing id="discount-code" what={empty ? missing.discountCode : null} />
    </form>
  );
}

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
  const [sending, once] = useOneAtATime();
  const [problem, setProblem] = useState<string | null>(null);
  const applied = hold.discount;
  const { onSending } = props;
  useEffect(() => {
    onSending(sending);
  }, [sending, onSending]);

  const apply = () =>
    once(async () => {
      setProblem(null);
      const answer = await api.enterCode(hold.id, typed.trim());
      if (!answer.ok) {
        setProblem(said(answer.code));
        return;
      }
      setTyped("");
      setOpen(false);
      onHold(answer.body);
    });

  const remove = () =>
    once(async () => {
      setProblem(null);
      const answer = await api.removeCode(hold.id);
      if (!answer.ok) {
        setProblem(said(answer.code));
        return;
      }
      onHold(answer.body);
    });

  const shown = problem !== null && (
    <p className={shared.problem} role="alert">
      {problem}
    </p>
  );

  if (applied !== null) {
    return (
      <Applied hold={hold} applied={applied} busy={busy || sending} removing={sending} onRemove={() => void remove()}>
        {shown}
      </Applied>
    );
  }

  if (!open) {
    return (
      <div className={styles.code}>
        <TextButton
          tone="muted"
          disabled={busy}
          onClick={() => {
            setOpen(true);
          }}
        >
          {copy.open}
        </TextButton>
      </div>
    );
  }

  return (
    <CodeForm
      typed={typed}
      problem={problem}
      held={busy || sending}
      sending={sending}
      onTyped={(value) => {
        setTyped(value);
        setProblem(null);
      }}
      onApply={() => void apply()}
    />
  );
}
