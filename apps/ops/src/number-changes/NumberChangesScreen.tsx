// Number changes waiting for ops: a code went to both numbers, and the change takes effect only once ops confirm it
// (docs/decisions/0042-client-profile.md). Built as the Referrals review queue is; a rejection needs a reason, a number
// someone else holds is refused, and each change says how long it has left, as Tasks counts it.

import { Field, TextArea } from "@maneman/ui/Field";
import { REASON_MAX_CHARS } from "@rules/policy/decision-reasons.ts";
import { errorText } from "@maneman/web-kit/refusal";
import { Button } from "@maneman/ui/Button";
import { useLoad } from "@maneman/ui/useLoad";
import { longDate } from "@maneman/web-kit/dates";
import { useRef, useState } from "react";
import { type NumberChange } from "../api.ts";
import { DecisionQueue } from "../components/DecisionQueue.tsx";
import { Reach } from "../components/Reach.tsx";
import { OpsLink } from "../components/Shell.tsx";
import { numberChanges } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { Left } from "../lib/Left.tsx";
import { phoneWords } from "../lib/phone.ts";
import { clientPath } from "../route.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import styles from "./number-changes.module.css";
import { Refusal } from "../components/Refusal.tsx";
import { numberChangesApi } from "./number-changes-api.ts";

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

/** Who is changing number, from which to which, how long it has left, and whether the new one is someone else's. */
function ChangeFacts({ change, now }: { change: ChangeProps["change"]; now: Date }) {
  return (
    <>
      <div className={styles.head}>
        <OpsLink className={styles.name} to={clientPath(change.person_id, "visits")}>
          {change.name}
        </OpsLink>
        <Left due={change.due} now={now} />
      </div>
      <p className={styles.when}>{copy.requested(longDate(change.requested_at))}</p>
      <p className={styles.move}>{copy.move(phoneWords(change.old_mobile), phoneWords(change.new_mobile))}</p>
      {/* Ops confirm the change with the client on the new number. */}
      <Reach name={change.name} mobile={change.new_mobile} />
      <p className={styles.proven}>{copy.proven}</p>
      {change.new_number_held_by !== null && (
        <p className={styles.proven}>{copy.heldBy(change.new_number_held_by.name, change.new_number_held_by.client)}</p>
      )}
    </>
  );
}

function Change({ change, now, mayDecide, onDecided }: ChangeProps) {
  const [deciding, setDeciding] = useState<Deciding>({ step: "open" });
  const [reason, setReason] = useState("");
  const rejectButton = useRef<HTMLButtonElement>(null);

  const decide = async (choice: Choice) => {
    setDeciding({ step: "sending", choice });
    const answer = await numberChangesApi.decideNumberChange(
      change.id,
      choice,
      choice === "reject" ? reason.trim() : null,
    );
    if (answer.ok) onDecided();
    else setDeciding({ step: "failed", code: answer.code });
  };

  const sending = deciding.step === "sending";
  // Only a rejection is asked about: the reason is what the route will not take without.
  const asking = deciding.step === "asking" || (sending && deciding.choice === "reject");

  return (
    <>
      <ChangeFacts change={change} now={now} />
      {asking && (
        <div className={styles.reason}>
          <Field label={copy.reason.label} look={{ label: styles.reasonLabel }}>
            {(control) => (
              <TextArea
                {...control}
                className={styles.reasonField}
                maxLength={REASON_MAX_CHARS}
                // The field stands where the button that asked for it stood, so the keyboard goes to it.
                autoFocus
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                }}
              />
            )}
          </Field>
          <div className={styles.actions}>
            <Button
              variant="outline"
              size="small"
              disabled={sending || reason.trim() === ""}
              onClick={() => void decide("reject")}
            >
              {sending ? copy.deciding : copy.reason.confirm}
            </Button>
            <Button
              variant="outline"
              size="small"
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
          <div className={styles.actions}>
            <Button variant="primary" size="small" disabled={sending} onClick={() => void decide("confirm")}>
              {sending ? copy.deciding : copy.confirm}
            </Button>
            <Button
              variant="outline"
              size="small"
              ref={rejectButton}
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
        <Refusal className={styles.error} said={errorText(copy.errors, { code: deciding.code })} />
      )}
    </>
  );
}

function NumberChangeQueue() {
  const [loaded, retry] = useLoad(numberChangesApi.numberChanges);
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
    <div className={styles.column}>
      <NumberChangeQueue />
    </div>
  );
}
