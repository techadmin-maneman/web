// Each alert as its inbox row says it (./AlertList.tsx): when it came, what it is, and the line beneath, from the facts
// the API kept with it. A job the phone may not name is named by its time and kind. The lock screen words its own,
// naming no client (../../sw/notice.ts).

import { weekdayName } from "@maneman/web-kit/dates";
import type { Alert } from "../api.ts";
import { alerts as copy, typesLower, types } from "../content.ts";
import { clock, dayBefore, dayMonth, todayInIndia } from "../lib/when.ts";
import type { AlertLine } from "./AlertList.tsx";

const MINUTE_MS = 60_000;

const at = (instant: string | null): string => (instant === null ? "" : clock(instant));

/** The job, as the line names it: its client where the phone may, or its time and kind. */
function whoOf(alert: Alert, instant: string | null): string {
  if (alert.client_name !== null) return alert.client_name;
  return copy.job(at(instant), alert.type === null ? "job" : typesLower[alert.type]);
}

/** "9:02 am" today, "Yesterday, 8 pm", or "Mon 9 Nov, 8 pm". */
function whenOf(sentAt: string, now: Date): string {
  const day = todayInIndia(new Date(sentAt));
  const today = todayInIndia(now);
  if (day === today) return clock(sentAt);
  if (day === dayBefore(today)) return copy.yesterday(clock(sentAt));
  return copy.earlier(`${weekdayName(day).slice(0, 3)} ${dayMonth(day)}`, clock(sentAt));
}

function wordsOf(alert: Alert): { title: string; body: string } {
  const kind = alert.type === null ? null : types[alert.type];
  switch (alert.kind) {
    case "time_to_leave": {
      const left = Math.max(1, Math.round((Date.parse(alert.leave_by ?? "") - Date.parse(alert.sent_at)) / MINUTE_MS));
      const drive =
        alert.drive_minutes === null || alert.sector === null
          ? (alert.sector ?? "")
          : copy.drive(alert.drive_minutes, alert.sector);
      return { title: copy.leave(left, whoOf(alert, alert.starts_at)), body: drive };
    }
    case "job_moved":
      return {
        title: copy.moved(whoOf(alert, alert.was_starts_at), at(alert.starts_at)),
        body: copy.was([kind, alert.sector], at(alert.was_starts_at)),
      };
    case "job_cancelled":
      return {
        title: copy.cancelled(alert.client_name, whoOf(alert, alert.starts_at)),
        body: [kind, at(alert.starts_at)].filter((part) => part !== null && part !== "").join(" · "),
      };
    case "job_reassigned":
      return { title: copy.reassigned(whoOf(alert, alert.starts_at)), body: at(alert.starts_at) };
    case "running_over":
      return { title: copy.over(at(alert.finish_by)), body: copy.overNext(at(alert.starts_at), alert.sector) };
    case "day_ahead":
      return {
        title: copy.dayAhead(alert.jobs ?? 0, at(alert.starts_at)),
        body: copy.first(alert.client_name, alert.sector),
      };
  }
}

/** The page a row opens: the job while it is the technician's, the day ahead's day; none for a job gone from them. */
function pageOf(alert: Alert): string | null {
  if (alert.kind === "day_ahead") return `/week/${alert.date}`;
  if (alert.kind === "job_cancelled" || alert.kind === "job_reassigned" || alert.job_id === null) return null;
  return `/jobs/${alert.job_id}`;
}

export function linesOf(alerts: readonly Alert[], now: Date): AlertLine[] {
  return alerts.map((alert) => ({
    id: alert.id,
    when: whenOf(alert.sent_at, now),
    ...wordsOf(alert),
    to: pageOf(alert),
  }));
}
