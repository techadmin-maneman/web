// What a push shows on the lock screen (./sw.ts): each alert not yet read, sent within the life of a push and not shown
// before, a notification each, in words that name no client, since a locked phone is seen by others; a job on another
// day says which. An alert older than a push lives, whose push this phone missed, waits in the inbox unshown. Navigate and
// Open job where the alert is about a job; a tap opens the job, the day ahead's day, or the inbox. Its own words, not
// the app's (../src/content.ts): the worker is built as one file and shares no module with the app.

/** The alert as GET /api/tech/alerts gives it, the parts a notification reads. */
export interface PushedAlert {
  readonly id: string;
  readonly kind: "time_to_leave" | "day_ahead" | "job_moved" | "job_cancelled" | "job_reassigned" | "running_over";
  readonly read: boolean;
  readonly sent_at: string;
  readonly job_id: string | null;
  readonly date: string | null;
  readonly type: "consultation" | "first_fit" | "service" | "replacement" | null;
  readonly sector: string | null;
  readonly starts_at: string | null;
  readonly was_starts_at: string | null;
  readonly leave_by: string | null;
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

const MINUTE_MS = 60_000;
/**
 * How old an alert can be when its push arrives (src/policy/tech-alerts.ts, PUSH_TTL_SECONDS): the cron pushes an
 * alert up to 30 minutes after it was written, and the push lives 30 minutes more. An alert older than both is one
 * whose push this phone missed.
 */
const FRESH_MS = 2 * 30 * MINUTE_MS;
const DAY_MS = 24 * 60 * MINUTE_MS;
const INDIA_MS = (5 * 60 + 30) * MINUTE_MS;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** An instant on India's clock, read as UTC. */
const inIndia = (instant: number): Date => new Date(instant + INDIA_MS);
const dayOf = (instant: number): string => inIndia(instant).toISOString().slice(0, 10);

/** "9:30 am", "4 pm": an instant on India's clock, as the app writes it. */
function clock(instant: number): string {
  const india = inIndia(instant);
  const hours = india.getUTCHours();
  const minutes = india.getUTCMinutes();
  const hour = hours % 12 === 0 ? 12 : hours % 12;
  return `${String(hour)}${minutes === 0 ? "" : `:${String(minutes).padStart(2, "0")}`} ${hours < 12 ? "am" : "pm"}`;
}

/** "4 pm" today, "tomorrow 4 pm", or "Thu 12 Nov, 4 pm": when, with the day where it is not today. */
function at(instant: string | null, now: number): string {
  if (instant === null) return "";
  const when = Date.parse(instant);
  if (dayOf(when) === dayOf(now)) return clock(when);
  if (dayOf(when) === dayOf(now + DAY_MS)) return `tomorrow ${clock(when)}`;
  const india = inIndia(when);
  const day = `${WEEKDAYS[india.getUTCDay()] ?? ""} ${String(india.getUTCDate())} ${MONTHS[india.getUTCMonth()] ?? ""}`;
  return `${day}, ${clock(when)}`;
}

const joined = (...parts: readonly (string | null)[]): string =>
  parts.filter((part) => part !== null && part !== "").join(" · ");

/** "11:30 am service visit", or "tomorrow 11:30 am service visit". */
const job = (alert: PushedAlert, now: number): string =>
  `${at(alert.starts_at, now)} ${alert.type === null ? "job" : KINDS[alert.type]}`.trim();

/** "Leave in 7 min" as the notification is shown, or "Time to leave" once the time has come. */
function leaveWords(alert: PushedAlert, now: number): string {
  const left = Math.round((Date.parse(alert.leave_by ?? "") - now) / MINUTE_MS);
  return Number.isFinite(left) && left > 0 ? `Leave in ${String(left)} min` : "Time to leave";
}

function wordsOf(alert: PushedAlert, now: number): { title: string; body: string } {
  switch (alert.kind) {
    case "time_to_leave":
      return { title: leaveWords(alert, now), body: joined(job(alert, now), alert.sector) };
    case "running_over":
      return {
        title: `Running over · finish by ${at(alert.finish_by, now)}`,
        body: joined(`for the ${job(alert, now)}`, alert.sector),
      };
    case "job_moved":
      return {
        title: `A job moved to ${at(alert.starts_at, now)}`,
        body: joined(alert.sector, `was ${at(alert.was_starts_at, now)}`),
      };
    case "job_cancelled":
      return { title: "A job was cancelled", body: job(alert, now) };
    case "job_reassigned":
      return { title: "A job went to another technician", body: job(alert, now) };
    case "day_ahead":
      return {
        title: `${alert.date === dayOf(now) ? "Today" : "Tomorrow"}: ${String(alert.jobs ?? 0)} ${alert.jobs === 1 ? "job" : "jobs"} from ${clock(Date.parse(alert.starts_at ?? ""))}`,
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

const noticeFor = (alert: PushedAlert, now: number): Notice => ({
  ...wordsOf(alert, now),
  tag: alert.id,
  open: pageOf(alert),
  navigate: alert.navigate,
});

/**
 * The notifications a push shows, newest first: each alert not yet read, sent within the life of a push and not shown
 * before. A push must show one, so with none new the newest such alert is shown again in its place, or, where none
 * could be read, the one that says to open the app. `noted` is every alert to remember as shown: those shown, and those
 * too old to show, whose push this phone missed.
 */
export function noticesOf(
  alerts: readonly PushedAlert[] | null,
  shown: ReadonlySet<string>,
  now: number,
): { readonly notices: Notice[]; readonly noted: string[] } {
  const unread = (alerts ?? []).filter((alert) => !alert.read);
  const fresh = unread.filter((alert) => now - Date.parse(alert.sent_at) <= FRESH_MS);
  const stale = unread.filter((alert) => !fresh.includes(alert)).map((alert) => alert.id);
  const fresher = fresh.filter((alert) => !shown.has(alert.id));
  if (fresher.length > 0) {
    return { notices: fresher.map((alert) => noticeFor(alert, now)), noted: [...fresher.map((a) => a.id), ...stale] };
  }
  const [newest] = fresh;
  const notices =
    newest === undefined
      ? [{ ...WORDS.unread, tag: "alerts", open: "/alerts", navigate: null }]
      : [noticeFor(newest, now)];
  return { notices, noted: stale };
}
