// The demand forecast's rules (docs/decisions/0179-demand-forecast.md): how its four layers add up, how wide its high
// case runs, and the rates it learns, each with what it falls back to before there is history to learn from.

/** Days a planning period lasts, and how many periods the forecast looks ahead, until ops set their own. */
export const PLANNING_PERIOD_DAYS = 7;
export const PLANNING_HORIZON_PERIODS = 12;

/** How many past periods of use the baseline averages. */
export const BASELINE_PERIODS = 8;

/** How far back the learned rates look, in days. */
export const LEARNING_DAYS = 180;

/** Before enough clients have fallen due, the share of them taken to book their replacement. */
export const DUE_BOOKING_RATE = 0.8;

/** Before enough consultations have been held, the share taken to become a first fit, and the days between. */
export const CONSULTATION_FIT_RATE = 0.5;
export const CONSULTATION_TO_FIT_DAYS = 14;

/** Fewer past cases than this, and a rate falls back to its default. */
const ENOUGH_TO_LEARN = 10;

/** What each layer expects of one stock code in one city in one period. */
export interface Layers {
  readonly booked: number;
  readonly due: number;
  readonly pipeline: number;
  readonly baseline: number;
}

const tenths = (value: number) => Math.round(value * 10) / 10;

/**
 * What a period is expected to use: what the visits booked, due and in the pipeline add up to, or the item's own
 * history where that is more, since the history sees what the other layers cannot (walk-ins, losses, a season).
 */
export function expectedOf(layers: Layers): number {
  return tenths(Math.max(layers.booked + layers.due + layers.pipeline, layers.baseline));
}

/** The high case: about one period in twenty uses more, taking use to arrive as a count does. */
export function highOf(expected: number): number {
  return tenths(expected + 1.65 * Math.sqrt(expected));
}

/** A rate learned from `outOf` past cases of which `happened` came to pass; the default before there are enough. */
export function learnedRate(happened: number, outOf: number, fallback: number): number {
  if (outOf < ENOUGH_TO_LEARN) return fallback;
  return Math.min(1, happened / outOf);
}

/** The period of the horizon a day falls in, counting from `today`; null outside it. */
export function periodOf(day: string, today: string, periodDays: number, horizonPeriods: number): number | null {
  const days = Math.round((Date.parse(day) - Date.parse(today)) / (24 * 60 * 60 * 1000));
  if (days < 0) return null;
  const period = Math.floor(days / periodDays);
  return period < horizonPeriods ? period : null;
}
