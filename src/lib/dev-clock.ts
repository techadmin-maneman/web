// The API's clock where DEV_ROUTES is on, locally only: the time the real clock reads, moved by however far
// PUT /api/dev/clock last set it (src/routes/dev-clock.ts), so a run of months can be played on a laptop without
// waiting on any of it. Requests, the cron and the queues all read it through deps.now (src/dependencies.ts). Held
// for the isolate, and a reload starts it from the real clock again, so a run also sends how far ahead it is on each
// request (DEV_CLOCK_HEADER), which puts a fresh isolate back on its clock.

let ahead = 0;

/** Now, moved as the dev clock was last set. */
export const devNow = (): Date => new Date(Date.now() + ahead);

/** Moves the clock so it reads `at`, in milliseconds, from here on. */
export function setDevClock(at: number): void {
  ahead = at - Date.now();
}

/** The header a run's every request says how far ahead of the real clock it is in, in milliseconds. */
export const DEV_CLOCK_HEADER = "X-Dev-Clock-Ahead";

/** Takes the clock from a request's header, where it names one. */
export function followDevClock(header: string | undefined): void {
  const said = Number(header);
  if (header !== undefined && Number.isFinite(said)) ahead = said;
}
