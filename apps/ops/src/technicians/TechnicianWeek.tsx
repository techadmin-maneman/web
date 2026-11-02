// A technician's week on their own page (./TechnicianScreen.tsx): what they have done over the roster's period, then
// their visits these seven days, a day at a time, as the dispatch board has them, with the way onto the board.

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

/** Their visits these seven days, from today, a line each under its day. */
function Visits({ technician }: { technician: TechnicianSummary }) {
  const read = useCallback(() => techniciansApi.board(todayInIndia(apiNow())), []);
  const [loaded, retry] = useLoad(read);
  if (loaded.state === "loading") return null;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const row = loaded.value.technicians.find((each) => each.technician_id === technician.id);
  const days = (row?.days ?? []).filter((day) => day.blocks.length > 0);
  if (days.length === 0) return <p className={styles.none}>{copy.none}</p>;
  return (
    <dl className={styles.week}>
      {days.map((day) => (
        <div key={day.date} className={styles.weekDay}>
          <dt>{shortDate(day.date)}</dt>
          {day.blocks.map((block) => (
            <dd key={block.appointment_id}>
              {copy.visit(
                indiaClock(block.starts_at),
                block.client ?? dispatch.unknown,
                block.type === null ? dispatch.unknown : dispatch.typeNames[block.type],
              )}
            </dd>
          ))}
        </div>
      ))}
    </dl>
  );
}

export function TechnicianWeek({ technician }: { technician: TechnicianSummary }) {
  return (
    <>
      <WorkStrip technicianId={technician.id} />
      <Visits technician={technician} />
      <div className={styles.actions}>
        <OpsLink
          className={buttonLook({ variant: "outline", size: "small", className: styles.quiet })}
          to={dispatchPath({ find: technician.name })}
        >
          {copy.open}
        </OpsLink>
      </div>
    </>
  );
}
