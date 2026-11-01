// The two clocks a hold runs on in the booking sheet: its countdown, which ends in a lapse, and the minute the sheet
// waits for a paid one to be booked.

import { useEffect, useEffectEvent } from "react";
import { api, type Hold } from "../api.ts";
import { apiNow } from "@maneman/web-kit/clock";
import type { BookingEvent } from "./flow.ts";
import { paysNothing } from "./pay.ts";

/** How often, and for how long, the sheet asks whether a paid hold is booked. */
const POLL_MS = 2_000;
const POLL_FOR_MS = 60_000;

/** How often the hold's deadline is read again, so a phone that slept, whose timers fall behind, lapses on waking. */
const LAPSE_CHECK_MS = 1_000;

/**
 * Calls `lapse` once the hold's deadline has passed, by the API's clock (packages/web-kit/clock.ts); nothing while there
 * is no hold. The deadline itself is read, each second and as the app comes back to the front, as the countdown reads
 * it: a timer set for the time left runs late on a phone that slept, and the sheet would sit at 0:00 meanwhile.
 */
export function useHoldLapse(hold: Hold | null, lapse: (hold: Hold) => void): void {
  // The newest lapse the sheet drew, without starting the clock again each time it draws one.
  const onLapse = useEffectEvent(lapse);
  useEffect(() => {
    if (hold === null) return;
    const deadline = Date.parse(hold.expires_at);
    let lapsed = false;
    const check = () => {
      if (lapsed || apiNow() < deadline) return;
      lapsed = true;
      onLapse(hold);
    };
    const timer = window.setTimeout(check, Math.max(0, deadline - apiNow()));
    const every = window.setInterval(check, LAPSE_CHECK_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(every);
      document.removeEventListener("visibilitychange", check);
    };
  }, [hold]);
}

/** Paid, or free: asks every two seconds, for a minute, whether the visit is booked, and says what it heard. */
export function usePollHold(hold: Hold | null, dispatch: (event: BookingEvent) => void): void {
  useEffect(() => {
    if (hold === null) return;
    const started = Date.now();
    let current = true;
    const ask = async () => {
      const answer = await api.holdById(hold.id);
      if (!current) return;
      if (answer.ok && answer.body.state === "booked") dispatch({ kind: "booked", hold: answer.body });
      else if (answer.ok && answer.body.state === "released") dispatch({ kind: "refunded" });
      else if (Date.now() - started > POLL_FOR_MS) dispatch({ kind: "slow", paid: !paysNothing(hold) });
      else timer = window.setTimeout(() => void ask(), POLL_MS);
    };
    let timer = window.setTimeout(() => void ask(), POLL_MS);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [hold, dispatch]);
}
