// Moving or cancelling a visit (boards C7 and C8; docs/decisions/0046-moving-and-cancelling.md). The sheet asks
// the API what the change costs now, and shows it before the client confirms. Moving goes on to the booking
// sheet's date and window, then pays whatever the move costs. Cancelling is confirmed on the terms shown; if the
// 24 hours ran out meanwhile, the new terms are shown instead.

import { weekdayDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type BookableType, type CancelTerms, type MoveTerms } from "../api.ts";
import { booking, change } from "../content.ts";
import { whatsappWith } from "../lib/whatsapp.ts";
import { methodName } from "../payments/entry.ts";
import { BookingSheet } from "./BookingSheet.tsx";
import styles from "./booking.module.css";

export interface ChangingVisit {
  readonly id: string;
  readonly type: BookableType;
  /** India's calendar date. */
  readonly date: string;
  /** What a message to ops says, should the app not be able to change it. */
  readonly message: string;
}

type Step =
  | { readonly kind: "loading" }
  | { readonly kind: "move"; readonly terms: MoveTerms }
  | { readonly kind: "cancel"; readonly terms: CancelTerms; readonly changed: boolean }
  | { readonly kind: "picking"; readonly terms: MoveTerms }
  | { readonly kind: "cancelled"; readonly terms: CancelTerms }
  | { readonly kind: "unchangeable" }
  | { readonly kind: "broken" };

/** What moving costs, in the design's words. */
function moveLine(terms: MoveTerms): string {
  if (terms.cost === "charged") return change.move.charged(rupees(terms.paid));
  if (terms.cost === "late_fee") return change.move.lateFee(rupees(terms.price.amount));
  return terms.paid > 0 ? change.move.free(rupees(terms.paid)) : change.move.freeNothingPaid;
}

/** The terms' line: ruled above when the change is free, and marked in red when it costs. */
const termsClass = (costs: boolean) => (costs ? `${styles.terms} ${styles.charged}` : styles.terms);

/** What cancelling gives back, and what it keeps. */
function cancelLine(terms: CancelTerms): string {
  const destination = methodName(terms.destination, "long") ?? change.destination;
  if (terms.refund > 0 && terms.kept > 0) {
    return change.cancel.lessFee(rupees(terms.kept), rupees(terms.refund), destination);
  }
  if (terms.refund > 0) return change.cancel.refund(rupees(terms.refund), destination);
  if (terms.kept > 0) return change.cancel.charged(rupees(terms.kept));
  return change.cancel.nothingPaid;
}

export function ChangeSheet(props: {
  visit: ChangingVisit;
  start: "move" | "cancel";
  onClose: (changed: boolean) => void;
}) {
  const { visit, onClose } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<Step>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const changed = useRef(false);
  const name = change.visit(weekdayDate(visit.date).split(" ")[0] ?? "");

  const show = useCallback(
    async (what: "move" | "cancel") => {
      setStep({ kind: "loading" });
      setProblem(null);
      const failed = (code: string): Step => ({ kind: code === "not_changeable" ? "unchangeable" : "broken" });
      if (what === "move") {
        const answer = await api.moveTerms(visit.id);
        setStep(answer.ok ? { kind: "move", terms: answer.body } : failed(answer.code));
      } else {
        const answer = await api.cancelTerms(visit.id);
        setStep(answer.ok ? { kind: "cancel", terms: answer.body, changed: false } : failed(answer.code));
      }
    },
    [visit.id],
  );

  useEffect(() => {
    dialog.current?.showModal();
    void show(props.start);
  }, [show, props.start]);

  const close = () => dialog.current?.close();

  const cancel = async (terms: CancelTerms) => {
    setBusy(true);
    setProblem(null);
    const answer = await api.cancel(visit.id, terms.notice);
    setBusy(false);
    if (answer.ok) {
      changed.current = true;
      setStep({ kind: "cancelled", terms: answer.body });
    } else if (answer.code === "terms_changed") {
      const fresh = await api.cancelTerms(visit.id);
      if (fresh.ok) setStep({ kind: "cancel", terms: fresh.body, changed: true });
      else setStep({ kind: "broken" });
    } else if (answer.code === "not_changeable") setStep({ kind: "unchangeable" });
    else setProblem(change.failed);
  };

  // Picking the new time is the booking sheet's, in its own dialog.
  if (step.kind === "picking") {
    return <BookingSheet type={visit.type} moving={step.terms} onClose={onClose} />;
  }

  return (
    <dialog
      ref={dialog}
      className={styles.sheet}
      aria-labelledby="change-title"
      onClose={() => {
        onClose(changed.current);
      }}
      onClick={(event) => {
        if (event.target === dialog.current) close();
      }}
    >
      <button className={styles.close} type="button" onClick={close}>
        {booking.close}
      </button>
      {step.kind === "loading" && <div className={styles.loading} aria-busy="true" />}
      {step.kind === "move" && (
        <>
          <h2 className={styles.changeTitle} id="change-title">
            {change.move.title(name)}
          </h2>
          <p className={termsClass(step.terms.cost !== "free")}>{moveLine(step.terms)}</p>
          <div className={styles.pair}>
            <button
              className={styles.primary}
              type="button"
              onClick={() => {
                setStep({ kind: "picking", terms: step.terms });
              }}
            >
              {step.terms.notice === "free" ? change.move.pick : change.move.accept}
            </button>
            <button className={styles.secondary} type="button" onClick={close}>
              {change.move.keep}
            </button>
          </div>
          <button className={styles.quiet} type="button" onClick={() => void show("cancel")}>
            {change.move.cancelInstead}
          </button>
        </>
      )}
      {step.kind === "cancel" && (
        <>
          <h2 className={styles.changeTitle} id="change-title">
            {change.cancel.title(name)}
          </h2>
          {step.changed && (
            <p className={styles.problem} role="alert">
              {change.termsChanged}
            </p>
          )}
          <p className={termsClass(step.terms.kept > 0)}>{cancelLine(step.terms)}</p>
          {problem !== null && (
            <p className={styles.problem} role="alert">
              {problem}
            </p>
          )}
          <div className={styles.pair}>
            <button className={styles.primary} type="button" disabled={busy} onClick={() => void cancel(step.terms)}>
              {step.terms.kept > 0 ? change.cancel.accept : change.cancel.confirm}
            </button>
            <button className={styles.secondary} type="button" onClick={close}>
              {change.cancel.keep}
            </button>
          </div>
        </>
      )}
      {step.kind === "cancelled" && (
        <div role="status">
          <p className={styles.caption}>{change.cancel.done}</p>
          <h2 className={styles.outcome} id="change-title">
            {change.cancel.doneLine(name)}
          </h2>
          <p className={styles.outcomeLine}>{cancelLine(step.terms)}</p>
          <button className={styles.secondary} type="button" onClick={close}>
            {change.cancel.close}
          </button>
        </div>
      )}
      {step.kind === "unchangeable" && (
        <div role="alert">
          <h2 className={styles.outcome} id="change-title">
            {change.notChangeable}
          </h2>
          <a className={styles.secondary} href={whatsappWith(visit.message)} rel="noopener">
            {change.message}
          </a>
        </div>
      )}
      {step.kind === "broken" && (
        <div role="alert">
          <h2 className={styles.outcome} id="change-title">
            {change.failed}
          </h2>
          <button className={styles.secondary} type="button" onClick={close}>
            {booking.close}
          </button>
        </div>
      )}
    </dialog>
  );
}
