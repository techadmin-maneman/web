// Dispute this charge (docs/decisions/0096-a-no-shows-charge-and-its-dispute.md): the client says, in their words,
// why a missed visit's charge is wrong, once a charge, and ops refund or uphold it. It takes the note sheet's frame.

import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { DISPUTE_REASON_MAX_CHARS } from "@rules/policy/no-show.ts";
import { Button } from "@maneman/ui/Button";
import { Sheet, SheetClose, SheetPanel } from "@maneman/ui/Sheet";
import { useEffect, useRef, useState } from "react";
import { api } from "../api.ts";
import { booking, dispute as copy } from "../content.ts";
import { focusIfLost } from "@maneman/ui/arrival";
import styles from "./booking.module.css";
import { WordsField } from "../components/WordsField.tsx";

type Step = "writing" | "sent" | "already" | "closed" | "failed";

/** The refusals the sheet answers in words of its own; any other is "failed". */
const REFUSALS: Readonly<Record<string, Step>> = { already_disputed: "already", dispute_window_closed: "closed" };

export function DisputeSheet(props: { visitId: string; onClose: (disputed: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState("");
  const [step, setStep] = useState<Step>("writing");
  const [busy, once] = useOneAtATime();

  useEffect(() => {
    focusIfLost(dialog.current?.querySelector<HTMLElement>("#dispute-title") ?? null);
  }, [step]);

  const close = () => dialog.current?.close();

  const send = () =>
    once(async () => {
      const answer = await api.dispute(props.visitId, text.trim());
      if (answer.ok) setStep("sent");
      else setStep(REFUSALS[answer.code] ?? "failed");
    });

  return (
    <Sheet
      ref={dialog}
      className={styles.dialog}
      labelledBy="dispute-title"
      onClose={() => {
        props.onClose(step !== "writing" && step !== "failed");
      }}
    >
      <SheetClose onClose={close}>{booking.close}</SheetClose>
      <SheetPanel className={styles.sheet}>
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
            <WordsField
              className={styles.noteField}
              label={copy.label}
              text={text}
              max={DISPUTE_REASON_MAX_CHARS}
              onText={setText}
            />
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
      </SheetPanel>
    </Sheet>
  );
}
