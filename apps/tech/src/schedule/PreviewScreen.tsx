// A later day's job, from Schedule (docs/prompts/tech-redesign.md, "Schedule"): read-only, its time and length, the
// area and how it is paid, and that the client's name and address come at 6 pm the day before. Back goes to its day.

import { DescriptionList } from "@maneman/ui/DescriptionList";
import { useLoad } from "@maneman/ui/useLoad";
import { weekdayName } from "@maneman/web-kit/dates";
import { useCallback } from "react";
import { api } from "../api.ts";
import { CardFrame } from "../frame/CardFrame.tsx";
import { Failed, Loading } from "../frame/States.tsx";
import { badges, job as jobCopy, schedule } from "../content.ts";
import { kindName } from "../lib/kind.ts";
import { clock, dayMonth } from "../lib/when.ts";
import { lengthOf } from "./ScheduleScreen.tsx";
import styles from "./schedule.module.css";

const copy = schedule.preview;

export function PreviewScreen({ date, id }: { readonly date: string; readonly id: string }) {
  const read = useCallback(() => api.jobs(date), [date]);
  const [loaded, retry] = useLoad(read);
  const back = `/week/${date}`;
  const day = schedule.day(weekdayName(date).slice(0, 3), dayMonth(date));
  if (loaded.state !== "loaded") {
    return (
      <CardFrame title={schedule.title} sub={day} back={back} foot={null}>
        {loaded.state === "loading" ? (
          <Loading />
        ) : (
          <Failed message={schedule.failed} retry={schedule.retry} onRetry={retry} requestId={loaded.requestId} />
        )}
      </CardFrame>
    );
  }
  const job = loaded.value.jobs.find((each) => each.id === id);
  if (job === undefined) {
    return (
      <CardFrame title={schedule.title} sub={day} back={back} foot={null}>
        <p className={styles.note}>{copy.gone}</p>
      </CardFrame>
    );
  }
  const length = lengthOf(job);
  return (
    <CardFrame title={kindName(job)} sub={copy.sub(day, clock(job.starts_at))} back={back} foot={null}>
      <DescriptionList
        className={styles.facts}
        layout="list"
        items={[
          { term: copy.time, details: copy.when(clock(job.starts_at), jobCopy.minutes(length)) },
          { term: copy.area, details: job.sector ?? "" },
          { term: copy.payment, details: badges[job.badge] },
        ]}
      />
      {!job.unlocked && <p className={styles.note}>{copy.locked}</p>}
    </CardFrame>
  );
}
