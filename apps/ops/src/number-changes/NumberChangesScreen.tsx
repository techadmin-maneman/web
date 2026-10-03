// Number changes: a client is moving to another mobile number, and the change
// waits here. The rule, quoted in migrations/0008_profile.sql, is "A code goes
// to both numbers. The change then waits for ops to confirm, and takes effect
// only after that confirmation" (docs/decisions/0042-client-profile.md).
//
// The design draws no board for it (docs/fidelity-method.md), so it is built as
// board C1's review queue is. Confirming moves the client at once, and the
// decision is written to the audit log as `number_change.decide`, under whoever
// Access says is signed in (ADR 0031). A rejection needs a reason; a number
// somebody else already holds is refused by the API, and said so here. Each
// change says how long it has left, counted as the Tasks board counts it.

import { Button } from "@maneman/ui/Button";
import { useLoad } from "@maneman/ui/useLoad";
import { longDate } from "@maneman/web-kit/dates";
import { useRef, useState } from "react";
import { api, type NumberChange } from "../api.ts";
import { DecisionQueue } from "../components/DecisionQueue.tsx";
import { OpsLink, Shell } from "../components/Shell.tsx";
import { numberChanges } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { Left } from "../lib/Left.tsx";
import { phoneWords } from "../lib/phone.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import styles from "./number-changes.module.css";

type Choice = "confirm" | "reject";

/** Where a change is in its decision: open, asked for a reason, sending, or refused by the API. */
type Deciding =
  | { readonly step: "open" }
  | { readonly step: "asking" }
  | { readonly step: "sending"; readonly choice: Choice }
  | { readonly step: "failed"; readonly code: string };

const copy = numberChanges.queue;

interface ChangeProps {
  readonly change: NumberChange;
  readonly now: Date;
  /** Whether the person's access lets them confirm or reject it. */
  readonly mayDecide: boolean;
  readonly onDecided: () => void;
}

function Change({ change, now, mayDecide, onDecided }: ChangeProps) {
  const [deciding, setDeciding] = useState<Deciding>({ step: "open" });
  const [reason, setReason] = useState("");
  const rejectButton = useRef<HTMLButtonElement>(null);

  const decide = async (choice: Choice) => {
    setDeciding({ step: "sending", choice });
    const answer = await api.decideNumberChange(change.id, choice, choice === "reject" ? reason.trim() : null);
    if (answer.ok) onDecided();
    else setDeciding({ step: "failed", code: answer.code });
  };

  const sending = deciding.step === "sending";
  // Only a rejection is asked about: the reason is what the route will not take without.
  const asking = deciding.step === "asking" || (sending && deciding.choice === "reject");

  return (
    <>
      <div className={styles.head}>
        <OpsLink className={styles.name} to={`/clients/${change.person_id}`}>
          {change.name}
        </OpsLink>
        <Left due={change.due} now={now} />
      </div>
      <p className={styles.when}>{copy.requested(longDate(change.requested_at))}</p>
      <p className={styles.move}>{copy.move(phoneWords(change.old_mobile), phoneWords(change.new_mobile))}</p>
      <p className={styles.proven}>{copy.proven}</p>
      {asking && (
        <div className={styles.reason}>
          <label className={styles.reasonLabel} htmlFor={`reason-${change.id}`}>
            {copy.reason.label}
          </label>
          <textarea
            id={`reason-${change.id}`}
            className={styles.reasonField}
            maxLength={300}
            // The field stands where the button that asked for it stood, so the keyboard goes to it.
            autoFocus
            aria-describedby={`reason-hint-${change.id}`}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
          <p className={styles.reasonHint} id={`reason-hint-${change.id}`}>
            {copy.reason.hint}
          </p>
          <div className={styles.actions}>
            <Button
              variant="outline"
              size="small"
              className={styles.quiet}
              disabled={sending || reason.trim() === ""}
              onClick={() => void decide("reject")}
            >
              {sending ? copy.deciding : copy.reason.confirm}
            </Button>
            <Button
              variant="outline"
              size="small"
              className={styles.quiet}
              disabled={sending}
              onClick={() => {
                setDeciding({ step: "open" });
                // Back to the button that asked, rather than to the top of the page.
                requestAnimationFrame(() => rejectButton.current?.focus());
              }}
            >
              {copy.reason.cancel}
            </Button>
          </div>
        </div>
      )}
      {!asking && mayDecide && (
        <div className={styles.decide}>
          <p className={styles.effect}>{copy.effect}</p>
          <div className={styles.actions}>
            <Button
              variant="primary"
              size="small"
              className={styles.confirm}
              disabled={sending}
              onClick={() => void decide("confirm")}
            >
              {sending ? copy.deciding : copy.confirm}
            </Button>
            <Button
              variant="outline"
              size="small"
              ref={rejectButton}
              className={styles.quiet}
              disabled={sending}
              onClick={() => {
                setDeciding({ step: "asking" });
              }}
            >
              {copy.reject}
            </Button>
          </div>
        </div>
      )}
      {deciding.step === "failed" && (
        <p className={styles.error} role="alert">
          {copy.errors[deciding.code] ?? copy.errors.unknown}
        </p>
      )}
    </>
  );
}

function Queue() {
  const [loaded, retry] = useLoad(api.numberChanges);
  const mayDecide = useAccess().mayCall("POST /api/number-changes/{id}/decision");
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;

  const now = new Date();
  return (
    <DecisionQueue
      titleId="number-changes"
      title={copy.title}
      items={loaded.value.changes}
      rowKind="change"
      empty={copy.empty}
    >
      {(change, decided) => <Change change={change} now={now} mayDecide={mayDecide} onDecided={decided} />}
    </DecisionQueue>
  );
}

export function NumberChangesScreen() {
  return (
    <Shell section="/number-changes" title={numberChanges.title}>
      <div className={styles.column}>
        <Queue />
      </div>
    </Shell>
  );
}
