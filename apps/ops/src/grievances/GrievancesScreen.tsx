// Grievances: what a client has said about the way we use their data, raised
// from their own app and answered here (docs/decisions/0049-dpdp.md). The
// hourly alert ops receive says "answer it in Grievances"; this is that section.
//
// The design draws no board for it (docs/fidelity-method.md), so it is built as
// the Referrals review queue is: the queue, a row for each, a decision on each row.
// Recording the answer closes the grievance and writes `grievance.resolve` to
// the audit log under whoever Access says is signed in (ADR 0031). It messages
// nobody: ops answer the client themselves, on the number shown.

import { errorText } from "@maneman/web-kit/refusal";
import { Button } from "@maneman/ui/Button";
import { Field, TextArea } from "@maneman/ui/Field";
import { useLoad } from "@maneman/ui/useLoad";
import { longDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { api, type Grievance } from "../api.ts";
import { DecisionQueue } from "../components/DecisionQueue.tsx";
import { Reach } from "../components/Reach.tsx";
import { OpsLink, Shell } from "../components/Shell.tsx";
import { grievances } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { Left } from "../lib/Left.tsx";
import { phoneWords } from "../lib/phone.ts";
import { clientPath } from "../route.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import styles from "./grievances.module.css";

/** Where a grievance is in its answer: open, sending, or refused by the API. */
type Answering =
  { readonly step: "open" } | { readonly step: "sending" } | { readonly step: "failed"; readonly code: string };

const copy = grievances.queue;

interface OpenProps {
  readonly each: Grievance;
  readonly now: Date;
  /** Whether the person's access lets them record the answer. */
  readonly mayAnswer: boolean;
  readonly onAnswered: () => void;
}

function Open({ each, now, mayAnswer, onAnswered }: OpenProps) {
  const [answering, setAnswering] = useState<Answering>({ step: "open" });
  const [response, setResponse] = useState("");

  const send = async () => {
    setAnswering({ step: "sending" });
    const answer = await api.resolveGrievance(each.id, response.trim());
    if (answer.ok) onAnswered();
    else setAnswering({ step: "failed", code: answer.code });
  };

  const sending = answering.step === "sending";
  return (
    <>
      <div className={styles.head}>
        <OpsLink className={styles.name} to={clientPath(each.person_id, "consents")}>
          {each.name}
        </OpsLink>
        <Left due={each.due} now={now} />
      </div>
      <p className={styles.who}>{copy.raised(phoneWords(each.mobile), longDate(each.raised_at))}</p>
      <Reach name={each.name} mobile={each.mobile} />
      {/* The client's own words, kept apart from ours so nobody answers a paraphrase. */}
      <blockquote className={styles.words}>{each.text}</blockquote>
      {mayAnswer && (
        <div className={styles.answer}>
          <Field label={copy.label} hint={copy.hint}>
            {(control) => (
              <TextArea
                {...control}
                className={styles.answerField}
                maxLength={2000}
                value={response}
                onChange={(event) => {
                  setResponse(event.target.value);
                }}
              />
            )}
          </Field>
          <div className={styles.actions}>
            <Button
              variant="primary"
              size="small"
              className={styles.send}
              disabled={sending || response.trim() === ""}
              onClick={() => void send()}
            >
              {sending ? copy.sending : copy.send}
            </Button>
          </div>
        </div>
      )}
      {answering.step === "failed" && (
        <p className={styles.error} role="alert">
          {errorText(copy.errors, { code: answering.code })}
        </p>
      )}
    </>
  );
}

function Queue() {
  const [loaded, retry] = useLoad(api.grievances);
  const mayAnswer = useAccess().mayCall("POST /api/grievances/{id}/resolve");
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;

  const now = new Date();
  return (
    <DecisionQueue
      titleId="grievances"
      title={copy.title}
      items={loaded.value.grievances}
      rowKind="grievance"
      empty={copy.empty}
      note={copy.note(copy.answerDays)}
    >
      {(each, answered) => <Open each={each} now={now} mayAnswer={mayAnswer} onAnswered={answered} />}
    </DecisionQueue>
  );
}

export function GrievancesScreen() {
  return (
    <Shell section="/grievances" title={grievances.title}>
      <div className={styles.column}>
        <Queue />
      </div>
    </Shell>
  );
}
