// The account's data card: a copy of the client's data, and a concern raised and answered
// (docs/decisions/0049-dpdp.md).

import { InlineMessage } from "@maneman/ui/InlineMessage";
import { capsLook } from "@maneman/ui/Caps";
import { GRIEVANCE_MAX_CHARS } from "@rules/policy/grievances.ts";
import { Button, ButtonLink } from "@maneman/ui/Button";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { longDate } from "@maneman/web-kit/dates";
import { useState, type ReactNode } from "react";
import { api, EXPORT_URL, type Profile } from "../api.ts";
import { profile } from "../content.ts";
import styles from "./profile.module.css";
import { WordsField } from "../components/WordsField.tsx";

type Grievance = Profile["grievances"][number];

/** Where a concern stands: still waiting for us, or answered on a day. */
function concernStatus(grievance: Grievance): string {
  if (grievance.answered_at === null) return profile.data.waiting;
  return profile.data.answered(longDate(grievance.answered_at));
}

/** A concern the client raised: when, where it stands, their own words, and our answer. */
function Concern({ grievance }: { grievance: Grievance }) {
  const copy = profile.data;
  return (
    <li className={styles.concern}>
      <p className={styles.concernHead}>{copy.concern(longDate(grievance.raised_at), concernStatus(grievance))}</p>
      <blockquote className={styles.concernWords}>{grievance.text}</blockquote>
      {grievance.response !== null && <p className={styles.concernAnswer}>{copy.answer(grievance.response)}</p>}
    </li>
  );
}

/** Why a concern did not go through: the day's allowance is spent, or anything else. */
function sendProblem(code: string): "limited" | "failed" {
  return code === "rate_limited" ? "limited" : "failed";
}

/** What the client writes to us: a grievance, up to the most it may be. */
function GrievanceField({ text, onText }: { text: string; onText: (text: string) => void }) {
  return (
    <WordsField
      className={styles.formField}
      label={profile.data.field}
      text={text}
      max={GRIEVANCE_MAX_CHARS}
      onText={onText}
    />
  );
}

/** The client's rights over their data: a copy of it, and a way to raise a concern (docs/decisions/0049-dpdp.md). */
export function DataCard({ grievances, onRaised }: { grievances: Profile["grievances"]; onRaised: () => void }) {
  const copy = profile.data;
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sent" | "failed" | "limited">("idle");
  // One concern per intent: every grievance ops see carries its own answer-time clock, and two
  // rows would be one client's one concern counted twice (docs/decisions/0049-dpdp.md).
  const [busy, once] = useOneAtATime();

  const send = () =>
    once(async () => {
      const answer = await api.raiseGrievance(text);
      if (!answer.ok) {
        setState(sendProblem(answer.code));
        return;
      }
      setState("sent");
      setWriting(false);
      onRaised();
    });

  /** A concern: sent, being written, or the way to raise one. */
  function concern(): ReactNode {
    if (state === "sent") {
      return (
        <p className={styles.cardHint} role="status">
          {copy.sent}
        </p>
      );
    }
    if (!writing) {
      return (
        <Button
          variant="outline"
          size="control"
          className={styles.secondary}
          onClick={() => {
            setWriting(true);
          }}
        >
          {copy.raise}
        </Button>
      );
    }
    return (
      <form
        className={styles.confirm}
        aria-busy={busy}
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <GrievanceField text={text} onText={setText} />
        {(state === "failed" || state === "limited") && (
          <InlineMessage tone="error" className={styles.error}>
            {state === "limited" ? copy.limited : copy.failed}
          </InlineMessage>
        )}
        <div className={styles.row}>
          <Button
            variant="primary"
            size="control"
            className={styles.primary}
            type="submit"
            disabled={busy || text.trim() === ""}
          >
            {copy.send}
          </Button>
          <Button
            variant="outline"
            size="control"
            className={styles.secondary}
            onClick={() => {
              setWriting(false);
            }}
          >
            {copy.cancel}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <section className={styles.card} aria-labelledby="data">
      <h2 className={capsLook(styles.cardLabel)} id="data">
        {copy.label}
      </h2>
      <p className={styles.cardBody}>{copy.body}</p>
      <ButtonLink variant="outline" size="control" className={styles.secondary} href={EXPORT_URL} download>
        {copy.download}
      </ButtonLink>
      {concern()}
      {grievances.length > 0 && (
        <ul className={styles.concerns} aria-label={copy.concerns}>
          {grievances.map((grievance) => (
            <Concern key={grievance.id} grievance={grievance} />
          ))}
        </ul>
      )}
    </section>
  );
}
