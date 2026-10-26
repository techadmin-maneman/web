// The technician's asks for leave (src/routes/tech/leave.ts): a new one, from one day to another with a line why, and
// each ask not yet past with where it stands. Ops decide each on Tasks; an approved one keeps those days clear of visits.

import { ICONS } from "@maneman/brand/icons";
import { Button } from "@maneman/ui/Button";
import { ErrorRef } from "@maneman/ui/ErrorRef";
import { DateInput, Field, TextArea } from "@maneman/ui/Field";
import { IconButton } from "@maneman/ui/IconButton";
import { useLoad } from "@maneman/ui/useLoad";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { dayMonth, todayInIndia } from "@maneman/web-kit/dates";
import { useState } from "react";
import { api, type LeaveRequests } from "../api.ts";
import { Offline } from "../components/Banners.tsx";
import { leave as copy, reference } from "../content.ts";
import { useScreen } from "../lib/useScreen.ts";
import { go } from "../route.ts";
import { useSession } from "../session.ts";
import { Failed, Loading } from "../states/States.tsx";
import frame from "../components/frame.module.css";
import styles from "./mine.module.css";
import { apiNow } from "@maneman/web-kit/clock";

/** Why an ask did not go through; `requestId` is the API's, to quote to ops. */
interface Problem {
  readonly words: string;
  readonly requestId: string | null;
}

function Ask({ offline, onAsked }: { offline: boolean; onAsked: (asks: LeaveRequests) => void }) {
  const today = todayInIndia(apiNow());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [note, setNote] = useState("");
  const [busy, once] = useOneAtATime();
  const [problem, setProblem] = useState<Problem | null>(null);
  const ask = () =>
    once(async () => {
      setProblem(null);
      const why = note.trim();
      const answer = await api.askLeave(why === "" ? { from, to } : { from, to, note: why });
      if (answer.ok) {
        setNote("");
        onAsked(answer.body);
      } else {
        setProblem({ words: answer.status === 400 ? copy.badDates : copy.notDone, requestId: answer.requestId });
      }
    });
  return (
    <div className={styles.form}>
      <Field onInk label={copy.from}>
        {(control) => (
          <DateInput
            {...control}
            onInk
            min={today}
            value={from}
            onChange={(event) => {
              const day = event.currentTarget.value;
              setFrom(day);
              if (to < day) setTo(day);
            }}
          />
        )}
      </Field>
      <Field onInk label={copy.to}>
        {(control) => (
          <DateInput
            {...control}
            onInk
            min={from}
            value={to}
            onChange={(event) => {
              setTo(event.currentTarget.value);
            }}
          />
        )}
      </Field>
      <Field onInk label={copy.note}>
        {(control) => (
          <TextArea
            {...control}
            maxLength={300}
            value={note}
            onChange={(event) => {
              setNote(event.currentTarget.value);
            }}
          />
        )}
      </Field>
      {problem !== null && (
        <div role="alert">
          <p className={styles.problem}>{problem.words}</p>
          {problem.requestId !== null && <ErrorRef requestId={problem.requestId} words={reference} />}
        </div>
      )}
      <Button
        variant="gold"
        size="action"
        busy={busy}
        disabled={offline || from === "" || to === ""}
        onClick={() => void ask()}
      >
        {offline ? copy.needsSignal : copy.ask}
      </Button>
    </div>
  );
}

export function LeaveScreen() {
  const { offline } = useSession();
  const heading = useScreen(copy.title);
  const [loaded, retry] = useLoad(api.leave);
  const [after, setAfter] = useState<LeaveRequests | null>(null);
  const asks = after ?? (loaded.state === "loaded" ? loaded.value : null);
  return (
    <main className={styles.screen}>
      <header className={frame.head}>
        <IconButton
          className={styles.back}
          d={ICONS.back}
          size="lg"
          weight="heavy"
          label={copy.back}
          onClick={() => {
            go("/");
          }}
        />
        <h1 className={styles.title} ref={heading} tabIndex={-1}>
          {copy.title}
        </h1>
      </header>
      {offline && <Offline />}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{copy.askTitle}</h2>
        <Ask offline={offline} onAsked={setAfter} />
      </section>
      {asks === null && loaded.state === "loading" && <Loading />}
      {asks === null && loaded.state === "failed" && (
        <Failed message={copy.failed} retry={copy.retry} onRetry={retry} requestId={loaded.requestId} />
      )}
      {asks !== null && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{copy.askedTitle}</h2>
          {asks.requests.length === 0 ? (
            <p className={styles.quiet}>{copy.none}</p>
          ) : (
            <ul className={styles.list}>
              {asks.requests.map((each) => (
                <li key={each.id} className={styles.figure}>
                  <span>{copy.days(dayMonth(each.from), dayMonth(each.to))}</span>
                  <span className={styles.state}>{copy.states[each.state]}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
