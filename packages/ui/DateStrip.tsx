// The days a visit can be booked on, as a row of squares: one group of native radios, so one tab stop, and the arrow
// keys move between the days. A day with nothing open is drawn but cannot be chosen. The client app's booking sheet
// and the site's /book and invite pages draw it alike, in one look; the site compiles it with Preact
// (site/astro.config.ts), so it uses nothing Preact lacks.

import { classes } from "./classes.ts";
import styles from "./date-strip.module.css";

export interface StripDate {
  /** YYYY-MM-DD. */
  readonly date: string;
  /** "Mon". */
  readonly weekday: string;
  /** "14". */
  readonly number: string;
  /** What a screen reader hears for the day, its state included: "Monday 14 October, full". */
  readonly label: string;
  readonly open: boolean;
  /** A short mark beneath the number, as for a day with a window inside the notice. */
  readonly marked?: boolean;
}

export function DateStrip(props: {
  /** The radios' name, one per form. */
  readonly name: string;
  readonly days: readonly StripDate[];
  readonly chosen: string | null;
  /** The heading the group is named by; without one, a fieldset around the strip names it. */
  readonly labelledBy?: string;
  readonly onChoose: (date: string) => void;
  /** The strip's place on its screen. */
  readonly className?: string | undefined;
}) {
  return (
    <div
      className={classes(styles.strip, props.className)}
      role={props.labelledBy === undefined ? undefined : "radiogroup"}
      aria-labelledby={props.labelledBy}
    >
      {props.days.map((day) => (
        <label key={day.date} className={styles.day}>
          <input
            className={styles.radio}
            type="radio"
            name={props.name}
            checked={day.date === props.chosen}
            disabled={!day.open}
            aria-label={day.label}
            onChange={() => {
              props.onChoose(day.date);
            }}
          />
          <span className={styles.weekday} aria-hidden="true">
            {day.weekday}
          </span>
          <span className={styles.number} aria-hidden="true">
            {day.number}
          </span>
          {day.marked === true && <span className={styles.mark} aria-hidden="true" />}
        </label>
      ))}
    </div>
  );
}
