// The two clocks a hold runs on in the booking sheet: its countdown, which ends in a lapse, and the minute the sheet
// waits for a paid one to be booked.

import { useEffect } from "react";
import { api, type Hold } from "../api.ts";
import { apiNow } from "../lib/clock.ts";
import type { BookingEvent } from "./flow.ts";
import { paysNothing } from "./steps/shared.tsx";

/** How often, and for how long, the sheet asks whether a paid hold is booked. */
const POLL_MS = 2_000;
const POLL_FOR_MS = 60_000;

/** Calls `lapse` when the hold's countdown ends, by the API's clock (lib/clock.ts); nothing while there is no hold. */
export function useHoldLapse(hold: Hold | null, lapse: (hold: Hold) => void): void {
  useEffect(() => {
    if (hold === null) return;
    const timer = window.setTimeout(
      () => {
        lapse(hold);
      },
      Math.max(0, Date.parse(hold.expires_at) - apiNow()),
    );
    return () => {
      window.clearTimeout(timer);
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
