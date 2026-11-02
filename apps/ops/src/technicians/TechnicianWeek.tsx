// A technician's week on their own page (./TechnicianScreen.tsx): how long a visit takes them and the way onto the
// board, then these seven days side by side, a card a day from today, each visit in its day as the board has it and
// opening there.

import { buttonLook } from "@maneman/ui/Button";
import { PanelFailed } from "@maneman/ui/States";
import { useLoad } from "@maneman/ui/useLoad";
import { indiaClock, shortDate, todayInIndia } from "@maneman/web-kit/dates";
import { useCallback } from "react";
import type { TechnicianSummary } from "../api.ts";
import { OpsLink } from "../frame/Shell.tsx";
import { dispatch, hoursAndMinutes, technicians } from "../content.ts";
import { dispatchPath } from "../route.ts";
import styles from "./technicians.module.css";
import { techniciansApi } from "./technicians-api.ts";
import { apiNow } from "@maneman/web-kit/clock";

const copy = technicians.week;

/**
 * How long a visit takes them where the phone timed any, and whether they run over; their jobs and how often they were
 * on time are the page's figures (./TechnicianHead.tsx).
 */
function WorkStrip({ technicianId }: { technicianId: string }) {
  const read = useCallback(() => techniciansApi.technicianWork(null), []);
  const [loaded] = useLoad(read);
  if (loaded.state !== "loaded") return null;
  const work = loaded.value.technicians.find((each) => each.technician_id === technicianId);
  // With no visit timed and none run over, there is nothing to say, and no empty line is left.
  if (work === undefined || (work.average_minutes === null && !work.runs_over)) return null;
  return (
    <p className={styles.strip}>
      {work.average_minutes !== null && <span>{copy.average(hoursAndMinutes(work.average_minutes))}</span>}
      {work.runs_over && <span className={styles.over}>{copy.runsOver}</span>}
    </p>
  );
}

/** These seven days from today, a card each, its visits in it, each opening on the board. */
function Visits({ technician }: { technician: TechnicianSummary }) {
  const today = todayInIndia(apiNow());
  const read = useCallback(() => techniciansApi.board(today), [today]);
  const [loaded, retry] = useLoad(read);
  if (loaded.state === "loading") return null;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const row = loaded.value.technicians.find((each) => each.technician_id === technician.id);
  // The board's own seven days, read from today, so a day is the board's whether or not they work it.
  const { dates } = loaded.value;
  return (
    <dl className={styles.week}>
      {dates.map((date) => {
        const blocks = row?.days.find((day) => day.date === date)?.blocks ?? [];
        return (
          <div key={date} className={styles.weekDay}>
            <dt>{shortDate(date)}</dt>
            {blocks.map((block) => (
              <dd key={block.appointment_id}>
                <OpsLink className={styles.weekVisit} to={dispatchPath({ from: date, visit: block.appointment_id })}>
                  {copy.visit(
                    indiaClock(block.starts_at),
                    block.client ?? dispatch.unknown,
                    block.type === null ? dispatch.unknown : dispatch.typeNames[block.type],
                  )}
                </OpsLink>
              </dd>
            ))}
          </div>
        );
      })}
    </dl>
  );
}

export function TechnicianWeek({ technician }: { technician: TechnicianSummary }) {
  return (
    <section className={styles.weekTab} aria-label={technicians.tabs.week}>
      <div className={styles.weekHead}>
        <WorkStrip technicianId={technician.id} />
        <OpsLink
          className={buttonLook({ variant: "outline", size: "small", className: styles.weekOpen })}
          to={dispatchPath({ find: technician.name })}
        >
          {copy.open}
        </OpsLink>
      </div>
      <Visits technician={technician} />
    </section>
  );
}
