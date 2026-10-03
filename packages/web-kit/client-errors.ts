// What goes wrong in an app's own page reaches mm-api, which logs it (src/routes/client-errors.ts): a script error, a
// promise nobody caught, a screen React could not draw, and a write the technician app's outbox gave up on. Without
// this, nobody but the person holding the phone would know.
//
// A page sends each error once, and only a few in all, so one stuck in a loop cannot flood the API. Sending is best
// effort: a report that does not arrive is let go.

const PATH = "/api/client-errors";
const MOST_PER_PAGE = 10;

/** The longest each field may be, as mm-api's route takes it. */
const LONGEST = { message: 500, stack: 4000, source: 500, path: 300 } as const;

export interface ClientError {
  readonly kind: "error" | "unhandled_rejection" | "render" | "outbox_gave_up";
  readonly message: string;
  readonly stack?: string;
  /** The script it was thrown in, and where. */
  readonly source?: string;
  readonly line?: number;
  readonly column?: number;
  /** A write the outbox gave up on: its kind, and the API's refusal of it. */
  readonly step?: string;
  readonly code?: string;
  readonly status?: number;
  readonly request_id?: string;
}

const sent = new Set<string>();

export function reportClientError(error: ClientError): void {
  const key = `${error.kind}:${error.message}`;
  if (sent.has(key) || sent.size >= MOST_PER_PAGE) return;
  sent.add(key);
  try {
    send(error);
  } catch {
    // A report never breaks what made it, as the outbox's round.
  }
}

function send(error: ClientError): void {
  const report: ClientError & { path: string } = {
    ...error,
    message: error.message.slice(0, LONGEST.message),
    ...(error.stack === undefined ? {} : { stack: error.stack.slice(0, LONGEST.stack) }),
    ...(error.source === undefined ? {} : { source: error.source.slice(0, LONGEST.source) }),
    path: window.location.pathname.slice(0, LONGEST.path),
  };
  fetch(PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(report),
    credentials: "same-origin",
    // Sent even as the page unloads; a redirect is never mm-api's, as behind the console's Access.
    keepalive: true,
    redirect: "manual",
  }).catch(() => undefined);
}

/** A thrown value's message and stack. Anything can be thrown, so a value that is not an Error is named by its type. */
function described(thrown: unknown): Pick<ClientError, "message" | "stack"> {
  if (thrown instanceof Error) {
    const message = `${thrown.name}: ${thrown.message}`;
    return thrown.stack === undefined ? { message } : { message, stack: thrown.stack };
  }
  if (typeof thrown === "string") return { message: thrown };
  return { message: Object.prototype.toString.call(thrown) };
}

/** From now on in this page, every script error and every promise nobody caught is reported. */
export function reportUncaughtErrors(): void {
  window.addEventListener("error", (event) => {
    const thrown: unknown = event.error;
    reportClientError({
      kind: "error",
      ...described(thrown ?? event.message),
      ...(event.filename === "" ? {} : { source: event.filename }),
      line: event.lineno,
      column: event.colno,
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason: unknown = event.reason;
    reportClientError({ kind: "unhandled_rejection", ...described(reason) });
  });
}

/** A screen an error boundary caught: React tells no listener of it, so the boundary reports it here. */
export function reportRenderError(thrown: unknown): void {
  reportClientError({ kind: "render", ...described(thrown) });
}
