// Grievances: what a client has said about the way we use their data, raised
// from their own app and answered here (docs/decisions/0049-dpdp.md). The
// alert ops receive says "answer it in the ops console"; this is that section.
//
// The design draws no board for it (docs/fidelity-method.md), so it is built as
// board C1's review queue is: the queue, a row for each, a decision on each row.
// Recording the answer closes the grievance and writes `grievance.resolve` to
// the audit log under whoever Access says is signed in (ADR 0031). It messages
// nobody: ops answer the client themselves, on the number shown.

import { longDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { api, type Grievance } from "../api.ts";
import { OpsLink, Shell } from "../components/Shell.tsx";
import { grievances, waiting } from "../content.ts";
import { daysUntil, dueAfter } from "../lib/due.ts";
import { useLoad } from "../lib/useLoad.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import styles from "./grievances.module.css";

/** Where a grievance is in its answer: open, sending, or refused by the API. */
type Answering =
  { readonly step: "open" } | { readonly step: "sending" } | { readonly step: "failed"; readonly code: string };

const copy = grievances.queue;

/** How long is left of the days the app promises, against the day it was raised. */
function Left({ raisedAt, now }: { raisedAt: string; now: Date }) {
  const days = daysUntil(dueAfter(raisedAt, copy.answerDays), now);
  const over = days < 0;
  return (
    <span className={`${styles.left ?? ""} ${over ? (styles.late ?? "") : ""}`}>
      {over ? waiting.over(-days) : days === 0 ? waiting.today : waiting.left(days)}
    </span>
  );
}

function Open({ each, now, onAnswered }: { each: Grievance; now: Date; onAnswered: () => void }) {
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
    <li className={styles.grievance}>
      <div className={styles.head}>
        <OpsLink className={styles.name} to={`/clients/${each.person_id}`}>
          {each.name}
        </OpsLink>
        <Left raisedAt={each.raised_at} now={now} />
      </div>
      <p className={styles.who}>{copy.raised(each.mobile, longDate(each.raised_at))}</p>
      {/* The client's own words, kept apart from ours so nobody answers a paraphrase. */}
      <blockquote className={styles.words}>{each.text}</blockquote>
      <div className={styles.answer}>
        <label className={styles.answerLabel} htmlFor={`answer-${each.id}`}>
          {copy.label}
        </label>
        <textarea
          id={`answer-${each.id}`}
          className={styles.answerField}
          maxLength={2000}
          value={response}
          onChange={(event) => {
            setResponse(event.target.value);
          }}
        />
        <p className={styles.answerHint}>{copy.hint}</p>
        <div className={styles.actions}>
          <button
            className={styles.send}
            type="button"
            disabled={sending || response.trim() === ""}
            onClick={() => void send()}
          >
            {sending ? copy.sending : copy.send}
          </button>
        </div>
      </div>
      {answering.step === "failed" && (
        <p className={styles.error} role="alert">
          {copy.errors[answering.code] ?? copy.errors.unknown}
        </p>
      )}
    </li>
  );
}

function Queue() {
  const [loaded, retry] = useLoad(api.grievances);
  // An answered grievance leaves the queue at once; the count follows it.
  const [answered, setAnswered] = useState<readonly string[]>([]);

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} />;

  const now = new Date();
  const open = loaded.value.grievances.filter((each) => !answered.includes(each.id));
  return (
    <section className={styles.panel} aria-labelledby="grievances">
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle} id="grievances">
          {copy.title}
        </h2>
        <span className={styles.count}>{open.length}</span>
      </div>
      {open.length === 0 ? (
        <p className={styles.empty}>{copy.empty}</p>
      ) : (
        <ul className={styles.grievances}>
          {open.map((each) => (
            <Open
              key={each.id}
              each={each}
              now={now}
              onAnswered={() => {
                setAnswered((already) => [...already, each.id]);
              }}
            />
          ))}
        </ul>
      )}
      <p className={styles.note}>{copy.note(copy.answerDays)}</p>
    </section>
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
