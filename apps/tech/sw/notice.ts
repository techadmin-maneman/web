// What a push shows on the lock screen (./sw.ts): the newest alert the API holds for the technician, in words that
// name no client, since a locked phone is seen by others. Navigate and Open job where the alert is about a job; a tap
// opens the job, the day ahead's day, or the inbox. Its own words, not the app's (../src/content.ts): the worker is
// built as one file and shares no module with the app.

/** The alert as GET /api/tech/alerts gives it, the parts a notification reads. */
export interface PushedAlert {
  readonly id: string;
  readonly kind: "time_to_leave" | "day_ahead" | "job_moved" | "job_cancelled" | "job_reassigned" | "running_over";
  readonly read: boolean;
  readonly job_id: string | null;
  readonly date: string | null;
  readonly type: "consultation" | "first_fit" | "service" | "replacement" | null;
  readonly sector: string | null;
  readonly starts_at: string | null;
  readonly was_starts_at: string | null;
  readonly drive_minutes: number | null;
  readonly finish_by: string | null;
  readonly jobs: number | null;
  readonly navigate: string | null;
}

export interface Notice {
  readonly title: string;
  readonly body: string;
  /** One notification an alert: a second push for it replaces the first. */
  readonly tag: string;
  /** The app's page a tap opens. */
  readonly open: string;
  readonly navigate: string | null;
}

const KINDS = {
  consultation: "consultation",
  first_fit: "first fit",
  service: "service visit",
  replacement: "replacement",
};

export const WORDS = {
  unread: { title: "New alert", body: "Open the app to see it." },
  navigate: "Navigate",
  openJob: "Open job",
} as const;

const INDIA_MS = (5 * 60 + 30) * 60_000;

/** "9:30 am", "4 pm": an instant on India's clock, as the app writes it. */
function at(instant: string | null): string {
  if (instant === null) return "";
  const india = new Date(Date.parse(instant) + INDIA_MS);
  const hours = india.getUTCHours();
  const minutes = india.getUTCMinutes();
  const hour = hours % 12 === 0 ? 12 : hours % 12;
  return `${String(hour)}${minutes === 0 ? "" : `:${String(minutes).padStart(2, "0")}`} ${hours < 12 ? "am" : "pm"}`;
}
const joined = (...parts: readonly (string | null)[]): string =>
  parts.filter((part) => part !== null && part !== "").join(" · ");

/** "11:30 am service visit" */
const job = (alert: PushedAlert): string =>
  joined(`${at(alert.starts_at)} ${alert.type === null ? "job" : KINDS[alert.type]}`.trim());

function wordsOf(alert: PushedAlert): { title: string; body: string } {
  switch (alert.kind) {
    case "time_to_leave":
      return { title: "Leave in 10 min", body: joined(job(alert), alert.sector) };
    case "running_over":
      return {
        title: `Running over · finish by ${at(alert.finish_by)}`,
        body: joined(`for the ${job(alert)}`, alert.sector),
      };
    case "job_moved":
      return {
        title: `A job moved to ${at(alert.starts_at)}`,
        body: joined(alert.sector, `was ${at(alert.was_starts_at)}`),
      };
    case "job_cancelled":
      return { title: "A job was cancelled", body: job(alert) };
    case "job_reassigned":
      return { title: "A job went to another technician", body: job(alert) };
    case "day_ahead":
      return {
        title: `Tomorrow: ${String(alert.jobs ?? 0)} ${alert.jobs === 1 ? "job" : "jobs"} from ${at(alert.starts_at)}`,
        body: alert.sector === null ? "" : `First in ${alert.sector}`,
      };
  }
}

/** The page a tap on the alert opens: its job while the job is the technician's, its day, or the inbox. */
function pageOf(alert: PushedAlert): string {
  if (alert.kind === "day_ahead" && alert.date !== null) return `/week/${alert.date}`;
  const gone = alert.kind === "job_cancelled" || alert.kind === "job_reassigned";
  return alert.job_id === null || gone ? "/alerts" : `/jobs/${alert.job_id}`;
}

/** The notification for the newest alert not yet read, or the one that says to open the app when none could be read. */
export function noticeOf(alerts: readonly PushedAlert[] | null): Notice {
  const newest = alerts?.find((alert) => !alert.read);
  if (newest === undefined) return { ...WORDS.unread, tag: "alerts", open: "/alerts", navigate: null };
  return { ...wordsOf(newest), tag: newest.id, open: pageOf(newest), navigate: newest.navigate };
}
