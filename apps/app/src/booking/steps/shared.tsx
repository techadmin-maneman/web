// What every step of the booking sheet (../BookingSheet.tsx) draws alike: its heading with the sheet's title id,
// the countdown, the late fee, and the step that is still loading.

import { capsLook } from "@maneman/ui/Caps";
import { apiNow } from "../../lib/clock.ts";
import { Icon } from "@maneman/ui/Icon";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import type { Hold, Price } from "../../api.ts";
import { booking, states } from "../../content.ts";
import { CLOCK } from "../../icons.ts";
import { priceFigures } from "../../lib/money.ts";
import { useSecondsLeft } from "@maneman/ui/useSecondsLeft";
import styles from "../booking.module.css";

/** The id every step's heading carries, which names the sheet (BookingSheet.tsx). */
export const TITLE_ID = "booking-title";

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Whole minutes and seconds: 9:42. */
export const minutesAndSeconds = (seconds: number) =>
  `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, "0")}`;

/** The seconds a hold has left, counted on the API's clock, which set its expiry. */
export const useHoldLeft = (hold: Hold): number => useSecondsLeft(Date.parse(hold.expires_at), apiNow);

/** A hold that costs the client nothing now: a free visit, or one a credit covers. Checkout never opens for it. */
export const paysNothing = (hold: Hold): boolean => hold.price.amount === 0 || hold.credit !== null;

/**
 * "Step 1 of 3" and "Step 2 of 3", as the boards number the date and the window, with the pay step the third; one
 * step later, and one step longer, for each the sheet takes before the date: the visit chosen (ADR 0085) and the
 * address asked for (ADR 0079).
 */
export const stepOf = (step: number, before: number): string => booking.step(step + before, 3 + before);

export function Heading({ title, step, aside }: { title: string; step?: string; aside?: string }) {
  return (
    <div className={styles.heading}>
      <h2 className={styles.title} id={TITLE_ID}>
        {title}
      </h2>
      {step !== undefined && <p className={capsLook(styles.step)}>{step}</p>}
      {aside !== undefined && (
        <p className={styles.held}>
          <Icon d={CLOCK} size={16} />
          {aside}
        </p>
      )}
    </div>
  );
}

/**
 * Said once, a minute before the hold lapses, by a status a screen reader reads as it changes. The
 * count itself is shown and never spoken, or it would be read out every second.
 */
export function LastMinute({ left }: { left: number }) {
  return (
    <VisuallyHidden as="p" role="status">
      {left > 0 && left <= 60 ? booking.lastMinute : ""}
    </VisuallyHidden>
  );
}

/**
 * The late fee's line, the same on the pay step and on moving a visit: the
 * amount charged in the sentence, and its GST split muted after it once GST applies.
 */
export function LateFee({ fee, noticeHours }: { fee: Price; noticeHours: number }) {
  const { amount, split } = priceFigures(fee);
  const copy = booking.lateFee;
  return (
    <>
      {copy.costs(amount, noticeHours)}
      {split !== null && <span className={styles.inclusive}>{copy.split(split)}</span>}
      {copy.rest}
    </>
  );
}

/** While the sheet asks for the days: named for a screen reader, drawn as the design's loading block. */
export function LoadingStep() {
  return (
    <>
      <VisuallyHidden as="h2" id={TITLE_ID}>
        {states.loading}
      </VisuallyHidden>
      <div className={styles.loading} aria-busy="true" />
    </>
  );
}
