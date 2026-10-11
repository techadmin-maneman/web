// Errors to Sentry: each error line the logger writes, already redacted, as one event, so a failure is counted,
// grouped and told rather than left in a day's logs. Sending runs after the response, never delays it, and never
// throws; a failure to send is a warning, which reports nothing, so it cannot loop.
//
//   POST https://<host>/api/<project>/envelope/?sentry_key=<key>&sentry_version=7

import type { SentryDsn } from "../lib/sentry-dsn.ts";
import type { ErrorSink, Logger } from "../log.ts";

const SEND_TIMEOUT_MS = 5_000;
/** At most this many events a minute from one isolate, and the same one once a minute, inside Sentry's free plan. */
const EVENTS_PER_MINUTE = 20;
const MINUTE_MS = 60_000;

/** The fields worth searching by, as Sentry's tags. */
const TAGS = ["surface", "route", "method", "status", "queue", "job", "app", "kind", "path", "step", "code"] as const;

/** A field as text for Sentry: a string as it is, anything else left out. */
const textOf = (value: unknown, fallback: string): string => (typeof value === "string" ? value : fallback);

/** An error a line carries, as the logger redacted it: its name, message and stack. */
interface RedactedError {
  readonly name?: unknown;
  readonly message?: unknown;
  readonly stack?: unknown;
}

const isRedactedError = (value: unknown): value is RedactedError =>
  typeof value === "object" && value !== null && "message" in value;

/** One line as a Sentry event: the error it carries, or its event name and message, with its fields beside it. */
export function eventOf(
  line: { readonly event: string; readonly fields: Readonly<Record<string, unknown>> },
  where: { readonly environment: string; readonly release: string | null },
  now: Date,
): Record<string, unknown> {
  const { event, fields } = line;
  const error = isRedactedError(fields.error) ? fields.error : null;
  const tags: Record<string, string> = { event };
  for (const name of TAGS) {
    const value = fields[name];
    if (typeof value === "string" || typeof value === "number") tags[name] = String(value).slice(0, 200);
  }
  const said = typeof fields.message === "string" ? `: ${fields.message}` : "";
  return {
    event_id: crypto.randomUUID().replaceAll("-", ""),
    timestamp: now.getTime() / 1000,
    platform: "javascript",
    level: "error",
    logger: "mm-api",
    environment: where.environment,
    ...(where.release === null ? {} : { release: where.release }),
    ...(error === null
      ? { message: { formatted: `${event}${said}`.slice(0, 500) } }
      : {
          exception: {
            values: [{ type: textOf(error.name, "Error"), value: textOf(error.message, "").slice(0, 500) }],
          },
        }),
    tags,
    extra: fields,
  };
}

/** The envelope Sentry takes: its header, the item's header, and the event. */
const envelopeOf = (dsn: SentryDsn, event: Record<string, unknown>, now: Date): string =>
  [
    JSON.stringify({ event_id: event.event_id, sent_at: now.toISOString(), dsn: dsn.raw }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(event),
  ].join("\n") + "\n";

/** What reporting needs: where, which release, how to send, and how to keep a send alive after the response. */
interface ErrorTracking {
  readonly dsn: SentryDsn;
  readonly environment: string;
  readonly release: string | null;
  readonly fetch: typeof fetch;
  readonly now: () => Date;
}

/** Holds the isolate to its share: so many events a minute, and each kind of event once a minute. */
function createThrottle(now: () => number) {
  let windowStart = 0;
  let sent = 0;
  const lastSeen = new Map<string, number>();
  return (key: string): boolean => {
    const at = now();
    if (at - windowStart >= MINUTE_MS) {
      windowStart = at;
      sent = 0;
    }
    if (sent >= EVENTS_PER_MINUTE || at - (lastSeen.get(key) ?? -MINUTE_MS) < MINUTE_MS) return false;
    lastSeen.set(key, at);
    sent += 1;
    return true;
  };
}

/** One per isolate: the throttle every request's and job's sink shares. */
export interface ErrorTracker {
  /** A sink for one request or job, keeping each send alive with its `waitUntil`. */
  sink(deps: { readonly waitUntil: (promise: Promise<unknown>) => void; readonly log: () => Logger }): ErrorSink;
}

/** Sends each error line to Sentry; a send that fails is a warning to `log`, which reports nothing. */
export function createErrorTracker(tracking: ErrorTracking): ErrorTracker {
  const allowed = createThrottle(() => tracking.now().getTime());
  return {
    sink: (deps) => (event, fields) => {
      const key = `${event}|${typeof fields.route === "string" ? fields.route : ""}|${textOf(fields.message, "")}`;
      if (!allowed(key)) return;
      const now = tracking.now();
      const body = envelopeOf(tracking.dsn, eventOf({ event, fields }, tracking, now), now);
      const sending = tracking
        .fetch(tracking.dsn.envelopeUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-sentry-envelope" },
          body,
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        })
        .then((response) => {
          if (!response.ok) deps.log().warn("error_tracking_refused", { status: response.status });
        })
        .catch((error: unknown) => {
          deps.log().warn("error_tracking_failed", { reason: error instanceof Error ? error.name : "unknown" });
        });
      deps.waitUntil(sending);
    },
  };
}
