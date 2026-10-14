// The API's clock, for both apps. A phone's own can be minutes or hours out: a hold counted on it lapses before it
// began, and a technician's "today" is the wrong day. Every fresh answer's Date header says what the API's clock read,
// so the apps count on the phone's clock moved by the difference (each app's api.ts).

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

/** How far the phone's clock is from the API's, in milliseconds, for the technician app to keep for offline opens. */
export const apiOffset = (): number => offset;

/** Starts from an offset kept on the phone, before any answer has been heard. */
export function startFrom(kept: number): void {
  offset = kept;
}

/** Whole seconds from now until `deadline`, a time by the API's clock in milliseconds; never below nought. */
export const secondsUntil = (deadline: number): number => Math.max(0, Math.ceil((deadline - apiNow()) / 1000));
