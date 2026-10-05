// Moving or cancelling a visit (boards C7 and C8; docs/decisions/0046-moving-and-cancelling.md). The sheet asks
// the API what the change costs now, and shows it before the client confirms. Moving goes on to the booking
// sheet's date and window, then pays whatever the move costs. Cancelling is confirmed on the terms shown; if the
// 24 hours ran out meanwhile, the new terms are shown instead.

import { capsLook } from "@maneman/ui/Caps";
import { fullDate, indiaDate, weekdayDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { Button, ButtonLink } from "@maneman/ui/Button";
import { Sheet, SheetPanel } from "@maneman/ui/Sheet";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, type BookableType, type CancelTerms, type Me, type MoveTerms } from "../api.ts";
import { booking, change, states } from "../content.ts";
import { focusIfLost } from "@maneman/ui/arrival";
import { whatsappWith } from "../lib/whatsapp.ts";
import { methodName } from "../payments/entry.ts";
import { useSession } from "../session.ts";
import { BookingSheet } from "./BookingSheet.tsx";
import { moveButton } from "./late-change.ts";
import { LateFee } from "./steps/shared.tsx";
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

/** Board C8's "One left": the credits the client still has, in words. */
const COUNTS = ["One", "Two", "Three", "Four", "Five", "Six"];

/** What moving costs, in the design's words; a late fee in the pay step's own line. */
function moveLine(terms: MoveTerms): ReactNode {
  if (terms.cost === "charged" && terms.credit !== null) return change.move.creditCharged;
  if (terms.cost === "charged") return change.move.charged(rupees(terms.paid));
  if (terms.cost === "late_fee") return <LateFee fee={terms.price} noticeHours={terms.notice_hours} />;
  return terms.paid > 0 ? change.move.free(rupees(terms.paid)) : change.move.freeNothingPaid;
}

/** What confirming a cancellation says: that a credit is lost, that a fee is kept, or only that it cancels. */
function cancelButton(terms: CancelTerms): string {
  if (terms.credit === "lost") return change.cancel.acceptCredit;
  return terms.kept > 0 ? change.cancel.accept : change.cancel.confirm;
}

/** The terms' line: ruled above when the change is free, and marked in red when it costs. */
const termsClass = (costs: boolean) => (costs ? `${styles.terms} ${styles.charged}` : styles.terms);

/** What cancelling gives back, and what it keeps; for a credit booking, what becomes of the credit. */
function cancelLine(terms: CancelTerms, credits: Me["credits"]): string {
  if (terms.credit === "restored") return change.cancel.creditBack;
  if (terms.credit === "lost") {
    const left = credits === null ? null : (COUNTS[credits.visits - 1] ?? String(credits.visits));
    const soonest = credits?.earliest_expiry ?? null;
    const expiry = soonest === null ? "" : fullDate(indiaDate(soonest));
    return change.cancel.creditUsed(left, expiry);
  }
  const destination = methodName(terms.destination, "long") ?? change.destination;
  if (terms.refund > 0 && terms.kept > 0) {
    return change.cancel.lessFee(rupees(terms.kept), rupees(terms.refund), destination);
  }
  if (terms.refund > 0) return change.cancel.refund(rupees(terms.refund), destination);
  if (terms.kept > 0) return change.cancel.charged(rupees(terms.kept));
  return change.cancel.nothingPaid;
}

/** What the cancel did: the terms' line, or, while its refund is still being sent, that it is on its way. */
function cancelledLine(terms: CancelTerms, credits: Me["credits"]): string {
  if (terms.refund_pending) return change.cancel.refundPending(rupees(terms.refund));
  return cancelLine(terms, credits);
}

export function ChangeSheet(props: {
  visit: ChangingVisit;
  start: "move" | "cancel";
  onClose: (changed: boolean) => void;
}) {
  const { visit, onClose } = props;
  const { me } = useSession();
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
    void show(props.start);
  }, [show, props.start]);

  // Each step's heading takes the focus the last step's button took with it: C7 to C8, and to what came of it.
  useEffect(() => {
    focusIfLost(dialog.current?.querySelector<HTMLElement>("#change-title") ?? null);
  }, [step.kind]);

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
    <Sheet
      ref={dialog}
      className={styles.dialog}
      labelledBy="change-title"
      onClose={() => {
        onClose(changed.current);
      }}
    >
      <button className={styles.close} type="button" onClick={close}>
        {booking.close}
      </button>
      <SheetPanel className={styles.sheet}>
        {step.kind === "loading" && (
          <>
            <VisuallyHidden as="h2" id="change-title">
              {states.loading}
            </VisuallyHidden>
            <div className={styles.loading} aria-busy="true" />
          </>
        )}
        {step.kind === "move" && (
          <>
            <h2 className={styles.changeTitle} id="change-title">
              {change.move.title(name)}
            </h2>
            <p className={termsClass(step.terms.cost !== "free")}>{moveLine(step.terms)}</p>
            <div className={styles.pair}>
              <Button
                variant="primary"
                size="control"
                className={styles.primary}
                onClick={() => {
                  setStep({ kind: "picking", terms: step.terms });
                }}
              >
                {moveButton(step.terms)}
              </Button>
              <Button variant="outline" size="control" className={styles.secondary} onClick={close}>
                {change.move.keep}
              </Button>
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
            <p className={termsClass(step.terms.kept > 0 || step.terms.credit === "lost")}>
              {cancelLine(step.terms, me.credits)}
            </p>
            {problem !== null && (
              <p className={styles.problem} role="alert">
                {problem}
              </p>
            )}
            <div className={styles.pair}>
              <Button
                variant="primary"
                size="control"
                className={styles.primary}
                disabled={busy}
                busy={busy}
                onClick={() => void cancel(step.terms)}
              >
                {cancelButton(step.terms)}
              </Button>
              <Button variant="outline" size="control" className={styles.secondary} onClick={close}>
                {change.cancel.keep}
              </Button>
            </div>
          </>
        )}
        {step.kind === "cancelled" && (
          <div role="status">
            <p className={capsLook(styles.caption)}>{change.cancel.done}</p>
            <h2 className={styles.outcome} id="change-title">
              {change.cancel.doneLine(name)}
            </h2>
            <p className={styles.outcomeLine}>{cancelledLine(step.terms, me.credits)}</p>
            <Button variant="outline" size="control" className={styles.secondary} onClick={close}>
              {change.cancel.close}
            </Button>
          </div>
        )}
        {step.kind === "unchangeable" && (
          <div role="alert">
            <h2 className={styles.outcome} id="change-title">
              {change.notChangeable}
            </h2>
            <ButtonLink
              variant="outline"
              size="control"
              className={styles.secondary}
              href={whatsappWith(visit.message)}
              rel="noopener"
            >
              {change.message}
            </ButtonLink>
          </div>
        )}
        {step.kind === "broken" && (
          <div role="alert">
            <h2 className={styles.outcome} id="change-title">
              {change.failed}
            </h2>
            <Button variant="outline" size="control" className={styles.secondary} onClick={close}>
              {booking.close}
            </Button>
          </div>
        )}
      </SheetPanel>
    </Sheet>
  );
}
