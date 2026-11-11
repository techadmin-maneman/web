// Each alert as its inbox row says it (./AlertList.tsx): when it came, what it is, and the line beneath, from the facts
// the API kept with it. A job the phone may not name is named by its time and kind; a job on another day says which.
// The lock screen words its own, naming no client (../../sw/notice.ts).

import { weekdayName } from "@maneman/web-kit/dates";
// The schema rather than ../api.ts, so the lines can be read and tested in Node without the fetch client.
import type { components } from "../api-schema.ts";
import { alerts as copy, typesLower, types } from "../content.ts";
import { clock, dayAfter, dayBefore, dayMonth, todayInIndia } from "../lib/when.ts";
import { theirs } from "../lang/index.ts";

/** A client's name or a sector, as the API gives it, kept as written inside the line (../lang/words.ts). */
const asGiven = (text: string | null): string | null => (text === null ? null : theirs(text));

/** One alert in the inbox, as its row says it. */
export interface AlertLine {
  readonly id: string;
  /** "9:02 am", "Yesterday, 8 pm" */
  readonly when: string;
  readonly title: string;
  readonly body: string;
  /** The page it opens: its job, its day, or nowhere when the job is no longer the technician's. */
  readonly to: string | null;
}

type Alert = components["schemas"]["TechnicianAlert"];

const MINUTE_MS = 60_000;

/** "4 pm" today, "tomorrow 4 pm", or "Thu 12 Nov, 4 pm". */
function atOn(instant: string | null, now: Date): string {
  if (instant === null) return "";
  const day = todayInIndia(new Date(instant));
  const today = todayInIndia(now);
  if (day === today) return clock(instant);
  if (day === dayAfter(today)) return copy.tomorrowAt(clock(instant));
  return copy.earlier(`${weekdayName(day).slice(0, 3)} ${dayMonth(day)}`, clock(instant));
}

/** The job, as the line names it: its client where the phone may, or its time and kind. */
function whoOf(alert: Alert, instant: string | null, now: Date): string {
  if (alert.client_name !== null) return theirs(alert.client_name);
  return copy.job(atOn(instant, now), alert.type === null ? "job" : typesLower[alert.type]);
}

/** "9:02 am" today, "Yesterday, 8 pm", or "Mon 9 Nov, 8 pm". */
function whenOf(sentAt: string, now: Date): string {
  const day = todayInIndia(new Date(sentAt));
  const today = todayInIndia(now);
  if (day === today) return clock(sentAt);
  if (day === dayBefore(today)) return copy.yesterday(clock(sentAt));
  return copy.earlier(`${weekdayName(day).slice(0, 3)} ${dayMonth(day)}`, clock(sentAt));
}

function wordsOf(alert: Alert, now: Date): { title: string; body: string } {
  const kind = alert.type === null ? null : types[alert.type];
  const at = (instant: string | null): string => atOn(instant, now);
  switch (alert.kind) {
    case "time_to_leave": {
      const left = Math.max(1, Math.round((Date.parse(alert.leave_by ?? "") - Date.parse(alert.sent_at)) / MINUTE_MS));
      const drive =
        alert.drive_minutes === null || alert.sector === null
          ? (alert.sector ?? "")
          : copy.drive(alert.drive_minutes, theirs(alert.sector));
      return { title: copy.leave(left, whoOf(alert, alert.starts_at, now)), body: drive };
    }
    case "job_moved":
      return {
        title: copy.moved(whoOf(alert, alert.was_starts_at, now), at(alert.starts_at)),
        body: copy.was([kind, asGiven(alert.sector)], at(alert.was_starts_at)),
      };
    case "job_cancelled":
      return {
        title: copy.cancelled(asGiven(alert.client_name), whoOf(alert, alert.starts_at, now)),
        body: [kind, at(alert.starts_at)].filter((part) => part !== null && part !== "").join(" · "),
      };
    case "job_reassigned":
      return { title: copy.reassigned(whoOf(alert, alert.starts_at, now)), body: at(alert.starts_at) };
    case "running_over":
      return { title: copy.over(at(alert.finish_by)), body: copy.overNext(at(alert.starts_at), asGiven(alert.sector)) };
    case "day_ahead":
      return {
        title: copy.dayAhead(alert.jobs ?? 0, alert.starts_at === null ? "" : clock(alert.starts_at)),
        body: copy.first(asGiven(alert.client_name), asGiven(alert.sector)),
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
    ...wordsOf(alert, now),
    to: pageOf(alert),
  }));
}
