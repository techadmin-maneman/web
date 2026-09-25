// The API's clock. A hold lasts ten minutes by the API's clock, and a phone's
// own can be minutes out: counted on the phone's, a hold 3 minutes fast reads
// "6:59" from the start, and one 11 minutes fast has lapsed before it began.
// Every fresh answer's Date header says what the API's clock read, so the app
// counts on the phone's clock moved by the difference (apps/app/src/api.ts).

let offset = 0;

/** The header counts whole seconds, so a phone within a couple of seconds of the API is taken at its word. */
const CLOSE_ENOUGH_MS = 2_000;

/** What an answer's Date header said, as the phone received it. */
export function heardFromApi(date: string | null, receivedAt: number = Date.now()): void {
  if (date === null) return;
  const said = Date.parse(date);
  if (Number.isNaN(said)) return;
  const gap = said - receivedAt;
  offset = Math.abs(gap) < CLOSE_ENOUGH_MS ? 0 : gap;
}

/** Now by the API's clock, in milliseconds. */
export const apiNow = (): number => Date.now() + offset;

/** Whole seconds from now until `deadline`, a time by the API's clock in milliseconds; never below nought. */
export const secondsUntil = (deadline: number): number => Math.max(0, Math.ceil((deadline - apiNow()) / 1000));
