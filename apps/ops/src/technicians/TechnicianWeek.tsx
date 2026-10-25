// A technician's week on their own page (./TechnicianScreen.tsx): what they have done over the roster's period, then
// their visits these seven days, a day at a time, as the dispatch board has them, with the way onto the board.

import { buttonLook } from "@maneman/ui/Button";
import { useLoad } from "@maneman/ui/useLoad";
import { indiaClock, shortDate, todayInIndia } from "@maneman/web-kit/dates";
import { useCallback } from "react";
import type { TechnicianSummary } from "../api.ts";
import { OpsLink } from "../components/Shell.tsx";
import { dispatch, hoursAndMinutes, technicians } from "../content.ts";
import { dispatchApi } from "../dispatch/dispatch-api.ts";
import { dispatchPath } from "../route.ts";
import styles from "./technicians.module.css";
import { techniciansApi } from "./technicians-api.ts";

const copy = technicians.week;

const DAY_MS = 86_400_000;

/** Their jobs over the roster's period and how long a visit takes them, where the phone timed any. */
function WorkStrip({ technicianId }: { technicianId: string }) {
  const read = useCallback(() => techniciansApi.technicianWork(null), []);
  const [loaded] = useLoad(read);
  if (loaded.state !== "loaded") return null;
  const work = loaded.value.technicians.find((each) => each.technician_id === technicianId);
  if (work === undefined) return null;
  const days = Math.round((Date.parse(loaded.value.to) - Date.parse(loaded.value.from)) / DAY_MS);
  return (
    <p className={styles.strip}>
      <span>{copy.jobs(work.jobs, days)}</span>
      {work.average_minutes !== null && <span>{copy.average(hoursAndMinutes(work.average_minutes))}</span>}
      {work.runs_over && <span className={styles.over}>{copy.runsOver}</span>}
    </p>
  );
}

/** Their visits these seven days, from today, a line each under its day. */
function Visits({ technician }: { technician: TechnicianSummary }) {
  const read = useCallback(() => dispatchApi.board({ from: todayInIndia(Date.now()), city: null }), []);
  const [loaded] = useLoad(read);
  if (loaded.state === "loading") return null;
  if (loaded.state === "failed") return <p className={styles.none}>{copy.failed}</p>;
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
