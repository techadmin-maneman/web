// Leave, from Me (src/routes/tech/leave.ts; docs/prompts/tech-redesign.md, "Me"), in the new look: a new ask, from one
// day to another with a line why, and each ask not yet past with where it stands. Ops decide each on Tasks; an
// approved one keeps those days clear of visits. Asking needs signal, and says so without it.

import { Button } from "@maneman/ui/Button";
import { ErrorRef } from "@maneman/ui/ErrorRef";
import { DayInput, Field, TextInput } from "@maneman/ui/Field";
import { SectionHead } from "@maneman/ui/SectionHead";
import { useLoad } from "@maneman/ui/useLoad";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { dayMonth, todayInIndia } from "@maneman/web-kit/dates";
import { sayNow } from "../lang/index.ts";
import { dayDate, spanEnds } from "../lib/when.ts";
import { apiNow } from "@maneman/web-kit/clock";
import { useState } from "react";
import { api, type LeaveRequests } from "../api.ts";
import { NoSignal } from "../frame/Banners.tsx";
import { CardFrame } from "../frame/CardFrame.tsx";
import { Failed, Loading } from "../frame/States.tsx";
import { leave as copy, reference } from "../content.ts";
import { useSession } from "../session.ts";
import styles from "./leave.module.css";

/** Why an ask did not go through; `requestId` is the API's, to quote to ops. */
interface Problem {
  readonly words: string;
  readonly requestId: string | null;
}

/** The two days, side by side: the last no earlier than the first, and both from today on. */
function Days(props: {
  readonly today: string;
  readonly from: string;
  readonly to: string;
  readonly onFrom: (day: string) => void;
  readonly onTo: (day: string) => void;
}) {
  return (
    <div className={styles.days}>
      <Field label={copy.from} look={{ label: styles.label }}>
        {(control) => (
          <DayInput
            {...control}
            shown={sayNow(dayDate(props.from))}
            min={props.today}
            value={props.from}
            onChange={(event) => {
              props.onFrom(event.currentTarget.value);
            }}
          />
        )}
      </Field>
      <Field label={copy.to} look={{ label: styles.label }}>
        {(control) => (
          <DayInput
            {...control}
            shown={sayNow(dayDate(props.to))}
            min={props.from}
            value={props.to}
            onChange={(event) => {
              props.onTo(event.currentTarget.value);
            }}
          />
        )}
      </Field>
    </div>
  );
}

function Ask({ offline, onAsked }: { readonly offline: boolean; readonly onAsked: (asks: LeaveRequests) => void }) {
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
      <Days
        today={today}
        from={from}
        to={to}
        onFrom={(day) => {
          setFrom(day);
          if (to < day) setTo(day);
        }}
        onTo={setTo}
      />
      <Field label={copy.note} look={{ label: styles.label }}>
        {(control) => (
          <TextInput
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
        variant="primary"
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

/** An ask's days: "6 Nov" for one, "20 to 22 Nov" for more, both months where they differ. */
function daysOf(from: string, to: string): string {
  return from === to ? dayMonth(from) : copy.days(...spanEnds(from, to));
}

const TONES: Readonly<Record<LeaveRequests["requests"][number]["state"], string | undefined>> = {
  asked: styles.asked,
  approved: styles.approved,
  declined: styles.declined,
};

export function LeaveScreen() {
  const { offline } = useSession();
  const [loaded, retry] = useLoad(api.leave);
  const [after, setAfter] = useState<LeaveRequests | null>(null);
  const asks = after ?? (loaded.state === "loaded" ? loaded.value : null);
  return (
    <CardFrame title={copy.title} back="/me" foot={null}>
      {offline && <NoSignal />}
      <div className={styles.page}>
        <SectionHead title={copy.askTitle} ruled={false} />
        <Ask offline={offline} onAsked={setAfter} />
        <SectionHead title={copy.askedTitle} size="list" className={styles.section} />
        {asks === null && loaded.state === "loading" && <Loading onPaper />}
        {asks === null && loaded.state === "failed" && (
          <Failed message={copy.failed} retry={copy.retry} onRetry={retry} requestId={loaded.requestId} onPaper />
        )}
        {asks !== null &&
          (asks.requests.length === 0 ? (
            <p className={styles.quiet}>{copy.none}</p>
          ) : (
            <ul className={styles.list}>
              {asks.requests.map((each) => (
                <li key={each.id} className={styles.row}>
                  <span>{daysOf(each.from, each.to)}</span>
                  <span className={TONES[each.state]}>{copy.states[each.state]}</span>
                </li>
              ))}
            </ul>
          ))}
      </div>
    </CardFrame>
  );
}
