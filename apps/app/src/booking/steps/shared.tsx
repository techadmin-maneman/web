// What every step of the booking sheet (../BookingSheet.tsx) draws alike: the design's full screen, with its head, its
// step bar, a body that scrolls and a footer for the step's button; the countdown, the late fee, and the step that is
// still loading.

import { ICONS } from "@maneman/brand/icons";
import { apiNow } from "@maneman/web-kit/clock";
import { classes } from "@maneman/ui/classes";
import { IconButton } from "@maneman/ui/IconButton";
import { StepProgress } from "@maneman/ui/Progress";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import type { ReactNode } from "react";
import { rupees } from "@maneman/web-kit/money";
import type { Hold, MoveTerms, Price } from "../../api.ts";
import { booking, change, states, withGst } from "../../content.ts";
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

/** Where a step stands among the sheet's: drawn as the bar, said to a screen reader as "Step 2 of 3". */
export interface StepAt {
  readonly at: number;
  readonly of: number;
}

/**
 * The day and time are the first of two steps, the review the second; one step later, and one step longer, for each
 * the sheet takes before them: the visit chosen (ADR 0085) and the address asked for (ADR 0079).
 */
export const stepOf = (step: number, before: number): StepAt => ({ at: step + before, of: 2 + before });

/**
 * A step as the design draws it, the height of the screen: its head, with the way back where there is one, its title
 * and the way out; the step bar; the step's own words, which scroll; and its button in a footer that stays.
 * `title`: left out by a step that names itself in its body, as a wait does. `onClose`: left out by one whose footer
 * has its own Close, so there are never two.
 */
export function Frame(props: {
  title?: string | undefined;
  step?: StepAt | undefined;
  onBack?: (() => void) | undefined;
  onClose?: (() => void) | undefined;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const { step } = props;
  return (
    <>
      <div className={classes(styles.top, props.onBack !== undefined && styles.topBack)}>
        {props.onBack !== undefined && (
          <IconButton
            className={styles.topButton}
            d={ICONS.back}
            size="md"
            label={booking.back}
            onClick={props.onBack}
          />
        )}
        {props.title === undefined ? (
          <span className={styles.topTitle} />
        ) : (
          <h2 className={styles.topTitle} id={TITLE_ID}>
            {props.title}
          </h2>
        )}
        {props.onClose !== undefined && (
          <IconButton
            className={styles.topButton}
            d={ICONS.cross}
            size="md"
            label={booking.close}
            onClick={props.onClose}
          />
        )}
      </div>
      {step !== undefined && (
        <>
          <StepProgress
            className={styles.bar}
            steps={Array.from({ length: step.of }, (_, index) => (index < step.at ? "done" : "todo"))}
          />
          <VisuallyHidden as="p">{booking.step(step.at, step.of)}</VisuallyHidden>
        </>
      )}
      <div className={styles.body}>{props.children}</div>
      {props.footer !== undefined && <div className={styles.footer}>{props.footer}</div>}
    </>
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
 * The late fee's line, the same on the review and on moving a visit: the
 * amount charged in the sentence, and its GST split muted after it once GST applies.
 */
export function LateFee({ fee, noticeHours }: { fee: Price; noticeHours: number }) {
  const { amount, split } = priceFigures(fee);
  const copy = booking.lateFee;
  return (
    <>
      {copy.costs(withGst(amount), noticeHours)}
      {split !== null && <span className={styles.inclusive}>{copy.split(split)}</span>}
      {copy.rest}
    </>
  );
}

/** What moving costs, in the design's words, on the change sheet and over the days of a move; a late fee in its own line. */
export function moveLine(terms: MoveTerms): ReactNode {
  if (terms.cost === "charged" && terms.credit !== null) return change.move.creditCharged;
  if (terms.cost === "charged") return change.move.charged(rupees(terms.paid));
  if (terms.cost === "late_fee") return <LateFee fee={terms.price} noticeHours={terms.notice_hours} />;
  return terms.paid > 0 ? change.move.free(rupees(terms.paid)) : change.move.freeNothingPaid;
}

/** While the sheet asks for the days: named for a screen reader, drawn as the design's loading block. */
export function LoadingStep({ onClose }: { onClose: () => void }) {
  return (
    <Frame onClose={onClose}>
      <VisuallyHidden as="h2" id={TITLE_ID}>
        {states.loading}
      </VisuallyHidden>
      <div className={styles.loading} aria-busy="true" />
    </Frame>
  );
}
