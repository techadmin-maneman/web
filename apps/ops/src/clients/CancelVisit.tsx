// Cancelling a client's visit from the console, from their Visits tab or the dispatch board's drawer. The panel shows
// what the cancel gives back before anything changes: free to the client, unless ops tick the client's own late terms.
// It goes only with a reason, which is kept with the cancel (src/routes/ops/visit-changes.ts). No board draws it.

import { REASON_MAX_CHARS } from "../../../../src/policy/decision-reasons.ts";
import { errorText } from "@maneman/web-kit/refusal";
import { Button } from "@maneman/ui/Button";
import { Dialog } from "@maneman/ui/Dialog";
import { Checkbox, Field, TextArea } from "@maneman/ui/Field";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { rupees } from "@maneman/web-kit/money";
import { useCallback, useEffect, useState } from "react";
import { api, type CancelOutcome, type CancelTerms } from "../api.ts";
import { clients } from "../content.ts";
import styles from "../components/visit-dialog.module.css";

const copy = clients.visits.cancel;

type Terms =
  | { readonly state: "loading" }
  | { readonly state: "failed"; readonly code: string }
  | { readonly state: "loaded"; readonly value: CancelTerms };

/** How the visit was paid for. */
function paidLine(terms: CancelTerms): string {
  if (terms.paid > 0) return copy.paid.money(rupees(terms.paid), destinationOf(terms));
  if (terms.free.credit !== null) return copy.paid.credit;
  return copy.paid.nothing;
}

const destinationOf = (terms: CancelTerms): string =>
  copy.destinations[terms.destination ?? ""] ?? copy.otherDestination;

/** What one choice of terms gives back, in a sentence or two. */
function givesOf(outcome: CancelOutcome, terms: CancelTerms): string {
  const parts: string[] = [];
  if (outcome.kept > 0) parts.push(copy.gives.kept(rupees(outcome.kept)));
  if (outcome.refund > 0) parts.push(copy.gives.refund(rupees(outcome.refund), destinationOf(terms)));
  if (outcome.credit !== null) parts.push(copy.gives[outcome.credit]);
  return parts.length === 0 ? copy.gives.nothing : parts.join(" ");
}

/** Whether the client's own terms would give back less than a cancel free to them. */
function lateTermsDiffer(terms: CancelTerms): boolean {
  const { free, client_terms: client } = terms;
  return free.refund !== client.refund || free.kept !== client.kept || free.credit !== client.credit;
}

function Form({
  terms,
  onCancelled,
  onTermsChanged,
}: {
  terms: CancelTerms;
  onCancelled: (gives: string) => void;
  onTermsChanged: () => void;
}) {
  const [onClientTerms, setOnClientTerms] = useState(false);
  const [reason, setReason] = useState("");
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, once] = useOneAtATime();
  const offerLateTerms = lateTermsDiffer(terms);
  const chosen = onClientTerms ? terms.client_terms : terms.free;
  const gives = givesOf(chosen, terms);

  const cancel = () =>
    once(async () => {
      setFailed(null);
      const answer = await api.cancelVisit(terms.visit_id, terms.notice, onClientTerms, reason.trim());
      if (answer.ok) {
        onCancelled(gives);
        return;
      }
      if (answer.code === "terms_changed") {
        onTermsChanged();
        return;
      }
      setFailed(errorText(copy.errors, { code: answer.code }));
    });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void cancel();
      }}
    >
      <p className={styles.done}>{paidLine(terms)}</p>
      <p className={styles.done}>{copy.terms(onClientTerms ? copy.clientTerms : copy.free, gives)}</p>
      {offerLateTerms && (
        <div className={styles.field}>
          <Checkbox
            label={copy.lateTerms}
            checked={onClientTerms}
            disabled={busy}
            onChange={(event) => {
              setOnClientTerms(event.currentTarget.checked);
            }}
          />
        </div>
      )}
      <Field className={styles.field} label={copy.reason}>
        {(control) => (
          <TextArea
            {...control}
            className={styles.reason}
            maxLength={REASON_MAX_CHARS}
            value={reason}
            disabled={busy}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        )}
      </Field>
      <div className={styles.actions}>
        <Button variant="danger" size="small" type="submit" busy={busy} disabled={reason.trim() === ""}>
          {busy ? copy.cancelling : copy.confirm}
        </Button>
      </div>
      {failed !== null && (
        <p className={styles.error} role="alert">
          {failed}
        </p>
      )}
    </form>
  );
}

/** Why the terms could not be read, and whether reading them again could help. */
function unreadableOf(code: string): { readonly said: string; readonly final: boolean } {
  if (code === "not_changeable" || code === "not_permitted") {
    return { said: copy.errors[code] ?? copy.unreadable, final: true };
  }
  if (code === "offline") return { said: copy.errors.offline ?? copy.unreadable, final: false };
  return { said: copy.unreadable, final: false };
}

/** The terms, read when the panel opens and again when the client's notice ran out while it was open. */
function useTerms(visitId: string): readonly [Terms, () => void] {
  const [terms, setTerms] = useState<Terms>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    void api.cancelTerms(visitId).then((answer) => {
      if (!current) return;
      setTerms(answer.ok ? { state: "loaded", value: answer.body } : { state: "failed", code: answer.code });
    });
    return () => {
      current = false;
    };
  }, [visitId, attempt]);

  const readAgain = useCallback(() => {
    setTerms({ state: "loading" });
    setAttempt((count) => count + 1);
  }, []);
  return [terms, readAgain] as const;
}

function Body({ visitId, onCancelled }: { visitId: string; onCancelled: (gives: string) => void }) {
  const [terms, readAgain] = useTerms(visitId);
  const [changed, setChanged] = useState(false);

  if (terms.state === "loading") return <p className={styles.note}>{copy.loading}</p>;
  if (terms.state === "failed") {
    const unreadable = unreadableOf(terms.code);
    return (
      <div>
        <p className={styles.error} role="alert">
          {unreadable.said}
        </p>
        {!unreadable.final && (
          <Button variant="outline" size="small" className={styles.quiet} onClick={readAgain}>
            {copy.retry}
          </Button>
        )}
      </div>
    );
  }
  return (
    <>
      {changed && (
        <p className={styles.error} role="alert">
          {copy.termsChanged}
        </p>
      )}
      <Form
        terms={terms.value}
        onCancelled={onCancelled}
        onTermsChanged={() => {
          setChanged(true);
          readAgain();
        }}
      />
    </>
  );
}

/** The panel ops cancel one client's visit in. Closing it says whether the visit was cancelled. */
export function CancelVisit({
  visitId,
  name,
  onClose,
}: {
  visitId: string;
  name: string;
  onClose: (cancelled: boolean) => void;
}) {
  const [cancelled, setCancelled] = useState<string | null>(null);
  const close = () => {
    onClose(cancelled !== null);
  };
  return (
    <Dialog className={styles.drawer} labelledBy="cancel-visit-title" canClose onDismiss={close}>
      <div className={styles.head}>
        <h2 className={styles.title} id="cancel-visit-title">
          {copy.title(name)}
        </h2>
        <Button variant="outline" size="small" className={styles.quiet} onClick={close}>
          {copy.close}
        </Button>
      </div>
      <div className={styles.body}>
        {cancelled === null ? (
          <Body visitId={visitId} onCancelled={setCancelled} />
        ) : (
          <p className={styles.done} role="status">
            {copy.done(cancelled)}
          </p>
        )}
      </div>
    </Dialog>
  );
}
