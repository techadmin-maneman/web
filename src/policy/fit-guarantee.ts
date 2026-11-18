// The fit guarantee (docs/decisions/0256-fit-guarantee-setting.md): after a client's first fit, a refit at no charge or a
// full refund, in the client's own judgment, for as many days as ops set (Settings · Rules, `guarantee_days`). The terms
// state it in those days; signing off the fit does not end it.

import { addDays } from "../lib/india-time.ts";

/** The days the terms gave it before it was a setting, which stand until ops set another. */
export const GUARANTEE_DAYS = 14;

/** India's last day a first fit on `fittedOn` may be claimed against: the day itself counts as the first. */
export const guaranteeUntil = (fittedOn: string, days: number): string => addDays(fittedOn, days - 1);
