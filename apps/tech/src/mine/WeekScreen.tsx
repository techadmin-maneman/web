// The technician's next six days after today, a day at a time: each job's time, kind and area, as the jobs route gives
// days past tomorrow. Today's own jobs are Today's.

import { ICONS } from "@maneman/brand/icons";
import { IconButton } from "@maneman/ui/IconButton";
import { useLoad } from "@maneman/ui/useLoad";
import { addDays, shortDate, todayInIndia } from "@maneman/web-kit/dates";
import { useCallback } from "react";
import { api } from "../api.ts";
import { types, week as copy } from "../content.ts";
import { useScreen } from "../lib/useScreen.ts";
import { clock } from "../lib/when.ts";
import { go } from "../route.ts";
import { Failed, Loading } from "../states/States.tsx";
import frame from "../components/frame.module.css";
import styles from "./mine.module.css";
import { apiNow } from "@maneman/web-kit/clock";

const DAYS = 6;

/** The days after today, each with its jobs; a day that would not load fails the week, which is tried again whole. */
async function readWeek(today: string) {
  const dates = Array.from({ length: DAYS }, (_, at) => addDays(today, at + 1));
  const answers = await Promise.all(dates.map((date) => api.jobs(date)));
  const failed = answers.find((answer) => !answer.ok);
  if (failed !== undefined) return failed;
  return {
    ok: true as const,
    body: dates.map((date, at) => {
      const answer = answers[at];
      return { date, jobs: answer?.ok === true ? answer.body.jobs : [] };
    }),
  };
}

export function WeekScreen() {
  const heading = useScreen(copy.title);
  const today = todayInIndia(apiNow());
  const read = useCallback(() => readWeek(today), [today]);
  const [loaded, retry] = useLoad(read);
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
      {loaded.state === "loading" && <Loading />}
      {loaded.state === "failed" && (
        <Failed message={copy.failed} retry={copy.retry} onRetry={retry} requestId={loaded.requestId} />
      )}
      {loaded.state === "loaded" &&
        loaded.value.map((day) => (
          <section key={day.date} className={styles.section} aria-labelledby={`day-${day.date}`}>
            <h2 className={styles.sectionTitle} id={`day-${day.date}`}>
              {shortDate(day.date)}
            </h2>
            {day.jobs.length === 0 ? (
              <p className={styles.quiet}>{copy.none}</p>
            ) : (
              <ul className={styles.list}>
                {day.jobs.map((job) => (
                  <li key={job.id} className={styles.line}>
                    {copy.job(clock(job.starts_at), job.type === null ? "" : types[job.type], job.sector ?? null)}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
    </main>
  );
}
