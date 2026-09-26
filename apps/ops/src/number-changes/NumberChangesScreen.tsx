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

import { longDate } from "@maneman/web-kit/dates";
import { useRef, useState } from "react";
import { api, type NumberChange } from "../api.ts";
import { OpsLink, Shell } from "../components/Shell.tsx";
import { numberChanges } from "../content.ts";
import { Left } from "../lib/Left.tsx";
import { phoneWords } from "../lib/phone.ts";
import { rowId, useTargetRow } from "../lib/target.ts";
import { useLoad } from "../lib/useLoad.ts";
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

function Change({
  change,
  now,
  targeted,
  onDecided,
}: {
  change: NumberChange;
  now: Date;
  targeted: boolean;
  onDecided: () => void;
}) {
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
    <li className={targeted ? styles.targeted : styles.change} id={rowId("change", change.id)} tabIndex={-1}>
      <div className={styles.head}>
        <OpsLink className={styles.name} to={`/clients/${change.person_id}`}>
          {change.name}
        </OpsLink>
        <Left due={change.due} now={now} />
      </div>
      <p className={styles.when}>{copy.requested(longDate(change.requested_at))}</p>
      <p className={styles.move}>{copy.move(phoneWords(change.old_mobile), phoneWords(change.new_mobile))}</p>
      <p className={styles.proven}>{copy.proven}</p>
      {asking ? (
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
            <button
              className={styles.quiet}
              type="button"
              disabled={sending || reason.trim() === ""}
              onClick={() => void decide("reject")}
            >
              {sending ? copy.deciding : copy.reason.confirm}
            </button>
            <button
              className={styles.quiet}
              type="button"
              disabled={sending}
              onClick={() => {
                setDeciding({ step: "open" });
                // Back to the button that asked, rather than to the top of the page.
                requestAnimationFrame(() => rejectButton.current?.focus());
              }}
            >
              {copy.reason.cancel}
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.decide}>
          <p className={styles.effect}>{copy.effect}</p>
          <div className={styles.actions}>
            <button className={styles.confirm} type="button" disabled={sending} onClick={() => void decide("confirm")}>
              {sending ? copy.deciding : copy.confirm}
            </button>
            <button
              ref={rejectButton}
              className={styles.quiet}
              type="button"
              disabled={sending}
              onClick={() => {
                setDeciding({ step: "asking" });
              }}
            >
              {copy.reject}
            </button>
          </div>
        </div>
      )}
      {deciding.step === "failed" && (
        <p className={styles.error} role="alert">
          {copy.errors[deciding.code] ?? copy.errors.unknown}
        </p>
      )}
    </li>
  );
}

function Queue() {
  const [loaded, retry] = useLoad(api.numberChanges);
  // A decided change leaves the queue at once; the count follows it, and so does the keyboard.
  const [decided, setDecided] = useState<readonly string[]>([]);
  const heading = useRef<HTMLHeadingElement>(null);
  const target = useTargetRow(loaded.state === "loaded");

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} />;

  const now = new Date();
  const open = loaded.value.changes.filter((change) => !decided.includes(change.id));
  return (
    <section className={styles.panel} aria-labelledby="number-changes">
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle} id="number-changes" ref={heading} tabIndex={-1}>
          {copy.title}
        </h2>
        <span className={styles.count}>{open.length}</span>
      </div>
      {open.length === 0 ? (
        <p className={styles.empty}>{copy.empty}</p>
      ) : (
        <ul className={styles.changes}>
          {open.map((change) => (
            <Change
              key={change.id}
              change={change}
              now={now}
              targeted={target === rowId("change", change.id)}
              onDecided={() => {
                setDecided((already) => [...already, change.id]);
                heading.current?.focus();
              }}
            />
          ))}
        </ul>
      )}
    </section>
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
