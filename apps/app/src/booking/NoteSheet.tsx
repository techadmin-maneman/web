// Add a note (REQ-04): while self-serve booking is on, the client's note goes on the visit itself, and the
// technician reads it on the client's card (POST /api/appointments/:id/note). The design draws the button and no
// sheet, so the sheet is ours, in the change sheet's frame, with placeholder words (docs/fidelity-method.md).
// Should the app be told booking is with ops after all, the note goes to them on WhatsApp, as it did before.

import { CLIENT_NOTE_MAX_CHARS } from "../../../../src/policy/client-notes.ts";
import { Button, ButtonLink } from "@maneman/ui/Button";
import { Sheet, SheetPanel } from "@maneman/ui/Sheet";
import { useEffect, useRef, useState } from "react";
import { api } from "../api.ts";
import { booking, note as copy } from "../content.ts";
import { focusIfLost } from "@maneman/ui/arrival";
import { whatsappWith } from "../lib/whatsapp.ts";
import { useSession } from "../session.ts";
import styles from "./booking.module.css";

type Step =
  | { readonly kind: "writing" }
  | { readonly kind: "saved" }
  | { readonly kind: "with_ops" }
  | { readonly kind: "failed" };

export function NoteSheet(props: {
  visitId: string;
  /** "Imran": who reads it, when the visit has a technician. */
  technician: string | null;
  /** The note the client left on the visit before, which the sheet opens with; null for none. */
  initial: string | null;
  /** The message to ops on WhatsApp, should the app not be able to keep the note. */
  message: string;
  /** Told the note as it was kept, so the visit's card shows it at once. */
  onSaved?: (note: string) => void;
  onClose: () => void;
}) {
  const { offline } = useSession();
  const dialog = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState(props.initial ?? "");
  const [step, setStep] = useState<Step>({ kind: "writing" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    focusIfLost(dialog.current?.querySelector<HTMLElement>("#note-title") ?? null);
  }, [step.kind]);

  const close = () => dialog.current?.close();

  const save = async () => {
    setBusy(true);
    const answer = await api.note(props.visitId, text.trim());
    setBusy(false);
    if (answer.ok) {
      setStep({ kind: "saved" });
      props.onSaved?.(answer.body.note);
    } else setStep({ kind: answer.code === "ops_assisted" ? "with_ops" : "failed" });
  };

  return (
    <Sheet ref={dialog} className={styles.dialog} labelledBy="note-title" onClose={props.onClose}>
      <button className={styles.close} type="button" onClick={close}>
        {booking.close}
      </button>
      <SheetPanel className={styles.sheet}>
        {step.kind === "writing" && (
          <form
            className={styles.noteForm}
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <h2 className={styles.changeTitle} id="note-title">
              {props.initial === null ? copy.title(props.technician) : copy.yours(props.technician)}
            </h2>
            <label className={styles.noteField}>
              <span className={styles.noteLabel}>{copy.label}</span>
              <textarea
                className={styles.noteInput}
                rows={4}
                maxLength={CLIENT_NOTE_MAX_CHARS}
                required
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                }}
              />
            </label>
            {offline && (
              <p className={styles.offlineLine} role="status">
                {copy.offline}
              </p>
            )}
            <Button
              variant="primary"
              size="action"
              className={styles.primary}
              type="submit"
              disabled={busy || offline || text.trim() === ""}
              busy={busy}
            >
              {busy ? copy.saving : copy.save}
            </Button>
          </form>
        )}
        {step.kind === "saved" && (
          <div role="status">
            <h2 className={styles.outcome} id="note-title">
              {copy.saved(props.technician)}
            </h2>
            <Button variant="outline" size="control" className={styles.secondary} onClick={close}>
              {booking.close}
            </Button>
          </div>
        )}
        {(step.kind === "with_ops" || step.kind === "failed") && (
          <div role="alert">
            <h2 className={styles.outcome} id="note-title">
              {step.kind === "with_ops" ? copy.withOps : copy.failed}
            </h2>
            <ButtonLink
              variant="outline"
              size="control"
              className={styles.secondary}
              href={whatsappWith(`${props.message}${text.trim()}`)}
              rel="noopener"
            >
              {copy.whatsapp}
            </ButtonLink>
          </div>
        )}
      </SheetPanel>
    </Sheet>
  );
}
