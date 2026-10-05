// Dispute this charge (docs/decisions/0096-a-no-shows-charge-and-its-dispute.md): the client says, in their words,
// why a no-show's charge is wrong, once a charge, and ops refund or uphold it. No board draws it, so the sheet is
// ours, in the note sheet's frame, with placeholder words (docs/fidelity-method.md).

import { DISPUTE_REASON_MAX_CHARS } from "../../../../src/policy/no-show.ts";
import { Button } from "@maneman/ui/Button";
import { Sheet } from "@maneman/ui/Sheet";
import { useEffect, useRef, useState } from "react";
import { api } from "../api.ts";
import { booking, dispute as copy } from "../content.ts";
import { focusIfLost } from "@maneman/ui/arrival";
import styles from "./booking.module.css";

type Step = "writing" | "sent" | "already" | "closed" | "failed";

/** The refusals the sheet answers in words of its own; any other is "failed". */
const REFUSALS: Readonly<Record<string, Step>> = { already_disputed: "already", dispute_window_closed: "closed" };

export function DisputeSheet(props: { visitId: string; onClose: (disputed: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState("");
  const [step, setStep] = useState<Step>("writing");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    focusIfLost(dialog.current?.querySelector<HTMLElement>("#dispute-title") ?? null);
  }, [step]);

  const close = () => dialog.current?.close();

  const send = async () => {
    setBusy(true);
    const answer = await api.dispute(props.visitId, text.trim());
    setBusy(false);
    if (answer.ok) setStep("sent");
    else setStep(REFUSALS[answer.code] ?? "failed");
  };

  return (
    <Sheet
      ref={dialog}
      className={styles.dialog}
      labelledBy="dispute-title"
      onClose={() => {
        props.onClose(step !== "writing" && step !== "failed");
      }}
    >
      <button className={styles.close} type="button" onClick={close}>
        {booking.close}
      </button>
      <div className={styles.sheet}>
        {step === "writing" && (
          <form
            className={styles.noteForm}
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <h2 className={styles.changeTitle} id="dispute-title">
              {copy.title}
            </h2>
            <label className={styles.noteField}>
              <span className={styles.noteLabel}>{copy.label}</span>
              <textarea
                className={styles.noteInput}
                rows={4}
                maxLength={DISPUTE_REASON_MAX_CHARS}
                required
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                }}
              />
            </label>
            <Button
              variant="primary"
              size="action"
              className={styles.primary}
              type="submit"
              disabled={busy || text.trim() === ""}
              busy={busy}
            >
              {busy ? copy.sending : copy.send}
            </Button>
          </form>
        )}
        {(step === "sent" || step === "already" || step === "closed") && (
          <div role="status">
            <h2 className={styles.outcome} id="dispute-title">
              {copy[step]}
            </h2>
            <Button variant="outline" size="control" className={styles.secondary} onClick={close}>
              {booking.close}
            </Button>
          </div>
        )}
        {step === "failed" && (
          <div role="alert">
            <h2 className={styles.outcome} id="dispute-title">
              {copy.failed}
            </h2>
            <Button
              variant="outline"
              size="control"
              className={styles.secondary}
              onClick={() => {
                setStep("writing");
              }}
            >
              {copy.tryAgain}
            </Button>
          </div>
        )}
      </div>
    </Sheet>
  );
}
