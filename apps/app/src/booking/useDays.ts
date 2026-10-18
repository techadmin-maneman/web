// The booking sheet's days (./BookingSheet.tsx): the strip the API answered, the day and start chosen on it, and the
// later days added on asking (ADR 0086). Opened on a visit the app offers, the first open day on or after the day
// offered is chosen, and the first open start in the window offered that day.

import { useState, type Dispatch } from "react";
import { api, type Availability, type BookingWindow, type Wanted } from "../api.ts";
import { addDays } from "@maneman/web-kit/dates";
import { firstOpenFrom, firstOpenIn, stillOpen, withDays } from "./days.ts";
import type { BookingEvent } from "./flow.ts";

/** Asking for the days after those shown: not yet, under way, or failed. */
type LaterAsk = "idle" | "busy" | "failed";

interface DaysAsked {
  readonly dispatch: Dispatch<BookingEvent>;
  /** The visit being moved; undefined for a new one. */
  readonly movingId: string | undefined;
  readonly offeredDate: string | undefined;
  readonly offeredWindow: BookingWindow | null | undefined;
  /** Whether the profile had no address when it was last read, so the address comes before the date. */
  readonly addressMissing: { readonly current: boolean };
}

export function useDays(asked: DaysAsked) {
  const { dispatch, movingId, offeredDate, offeredWindow } = asked;
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [laterAsk, setLaterAsk] = useState<LaterAsk>("idle");
  const [date, setDate] = useState<string | null>(null);
  const [chosenStart, setChosenStart] = useState<string | null>(null);

  /** The days of the visit wanted, and the step after them: the address if there is none yet, else the date. */
  const showDays = (days: Availability) => {
    setAvailability(days);
    setLaterAsk("idle");
    const chosen = offeredDate === undefined ? null : firstOpenFrom(days.days, offeredDate);
    setDate(chosen);
    setChosenStart(
      firstOpenIn(
        days.days.find((each) => each.date === chosen),
        offeredWindow,
      ),
    );
    dispatch({ kind: "answered", picking: false, addressMissing: asked.addressMissing.current });
  };

  /** A day the client chose: the first open start in the window offered, where it has one. */
  const chooseDate = (chosen: string) => {
    setDate(chosen);
    setChosenStart(
      firstOpenIn(
        availability?.days.find((each) => each.date === chosen),
        offeredWindow,
      ),
    );
  };

  const addDaysFrom = (fresh: Availability) => {
    setAvailability((now) => (now === null ? fresh : { ...fresh, days: withDays(now.days, fresh.days) }));
  };

  /** The days after the last shown, added to the strip. */
  const showLater = async (wanted: Wanted | null) => {
    const lastShown = availability?.days.at(-1)?.date;
    if (wanted === null || lastShown === undefined) return;
    setLaterAsk("busy");
    const answer = await api.availability(wanted, movingId, addDays(lastShown, 1));
    if (!answer.ok) {
      setLaterAsk("failed");
      return;
    }
    setLaterAsk("idle");
    addDaysFrom(answer.body);
  };

  /**
   * The start chosen was taken: the days again from the day chosen, which may be among the later days. A start the
   * client picks while this is asked for stays picked where it is still open.
   */
  const askAgainFrom = async (wanted: Wanted, from: string) => {
    setChosenStart(null);
    const fresh = await api.availability(wanted, movingId, from);
    if (!fresh.ok) return;
    addDaysFrom(fresh.body);
    const day = fresh.body.days.find((each) => each.date === from);
    setChosenStart((picked) => stillOpen(day, picked));
  };

  return {
    availability,
    laterAsk,
    date,
    chosenStart,
    setChosenStart,
    showDays,
    chooseDate,
    showLater,
    askAgainFrom,
  };
}

/** The days the sheet offers, and the client's day and start among them. */
export type Days = ReturnType<typeof useDays>;
