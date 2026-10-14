// Grievances: what a client has said about how we use their data, raised in their app and answered here
// (docs/decisions/0049-dpdp.md), built as the Referrals review queue is. Recording the answer closes it and writes
// `grievance.resolve` to the audit log (ADR 0031); it messages nobody, since ops answer the client on the number shown.

import { errorText } from "@maneman/web-kit/refusal";
import { Button } from "@maneman/ui/Button";
import { Field, TextArea } from "@maneman/ui/Field";
import { useLoad } from "@maneman/ui/useLoad";
import { longDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { api, type Grievance } from "../api.ts";
import { DecisionQueue } from "../components/DecisionQueue.tsx";
import { Reach } from "../components/Reach.tsx";
import { OpsLink } from "../components/Shell.tsx";
import { grievances } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { Left } from "../lib/Left.tsx";
import { phoneWords } from "../lib/phone.ts";
import { clientPath } from "../route.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import styles from "./grievances.module.css";
import { Refusal } from "../components/Refusal.tsx";

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
          <Field label={copy.label}>
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
              disabled={sending || response.trim() === ""}
              onClick={() => void send()}
            >
              {sending ? copy.sending : copy.send}
            </Button>
          </div>
        </div>
      )}
      {answering.step === "failed" && (
        <Refusal className={styles.error} said={errorText(copy.errors, { code: answering.code })} />
      )}
    </>
  );
}

function GrievanceQueue() {
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
      more={loaded.value.more}
      rowKind="grievance"
      empty={copy.empty}
    >
      {(each, answered) => <Open each={each} now={now} mayAnswer={mayAnswer} onAnswered={answered} />}
    </DecisionQueue>
  );
}

export function GrievancesScreen() {
  return (
    <div className={styles.column}>
      <GrievanceQueue />
    </div>
  );
}
