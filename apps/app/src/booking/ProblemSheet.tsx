// Something wrong with the hair system, or with a visit, told to Care in the client's words; Care answer on
// WhatsApp, where the client's photographs go too. No board draws it, so the sheet is ours, in the note sheet's frame.

import { Field, TextArea } from "@maneman/ui/Field";
import { PROBLEM_MAX_CHARS } from "@rules/policy/problems.ts";
import { Button, ButtonLink } from "@maneman/ui/Button";
import { Sheet, SheetClose, SheetPanel } from "@maneman/ui/Sheet";
import { TextButton } from "@maneman/ui/TextLink";
import { focusIfLost } from "@maneman/ui/arrival";
import { useEffect, useRef, useState } from "react";
import { api } from "../api.ts";
import { booking, problem as copy } from "../content.ts";
import { whatsappWith } from "../lib/whatsapp.ts";
import styles from "./booking.module.css";

type Step = "writing" | "sent" | "limited" | "failed";

type About = { readonly about: "hair_system" } | { readonly about: "visit"; readonly visitId: string };

function ProblemSheet({ about, onClose }: { about: About; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState("");
  const [step, setStep] = useState<Step>("writing");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    focusIfLost(dialog.current?.querySelector<HTMLElement>("#problem-title") ?? null);
  }, [step]);

  const close = () => dialog.current?.close();

  const send = async () => {
    setBusy(true);
    const visitId = about.about === "visit" ? about.visitId : null;
    const answer = await api.reportProblem({ about: about.about, visit_id: visitId, text: text.trim() });
    setBusy(false);
    if (answer.ok) setStep("sent");
    else setStep(answer.code === "rate_limited" ? "limited" : "failed");
  };

  return (
    <Sheet ref={dialog} className={styles.dialog} labelledBy="problem-title" onClose={onClose}>
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
            <h2 className={styles.changeTitle} id="problem-title">
              {copy.title[about.about]}
            </h2>
            <Field className={styles.noteField} label={copy.label}>
              {(control) => (
                <TextArea
                  {...control}
                  rows={4}
                  maxLength={PROBLEM_MAX_CHARS}
                  required
                  value={text}
                  onChange={(event) => {
                    setText(event.target.value);
                  }}
                />
              )}
            </Field>
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
        {step === "sent" && (
          <div role="status">
            <h2 className={styles.outcome} id="problem-title">
              {copy.sent}
            </h2>
            <ButtonLink variant="outline" size="control" className={styles.secondary} href={whatsappWith(copy.photos)}>
              {copy.addPhotos}
            </ButtonLink>
          </div>
        )}
        {(step === "limited" || step === "failed") && (
          <div role="alert">
            <h2 className={styles.outcome} id="problem-title">
              {copy[step]}
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

/** "Something wrong with your hair system?", or with this visit: the words that open the sheet. */
export function ProblemLink({ about, className }: { about: About; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TextButton
        tone="muted"
        className={className}
        onClick={() => {
          setOpen(true);
        }}
      >
        {copy.link[about.about]}
      </TextButton>
      {open && (
        <ProblemSheet
          about={about}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
