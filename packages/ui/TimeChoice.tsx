// The starts a visit can be booked at on the day chosen (docs/decisions/0210-booking-by-start-time.md), under the
// day's periods, each a time to choose, open or taken. A taken time stays where it is, struck through, so the grid
// keeps its shape; a period with nothing open says so. The client app's booking sheet and the site's /book page draw
// it alike; the site compiles it with Preact (site/astro.config.ts), so it uses nothing Preact lacks.

import { VisuallyHidden } from "./VisuallyHidden.tsx";
import { classes } from "./classes.ts";
import styles from "./time-choice.module.css";

export interface TimeOption {
  /** What is sent: the start as an instant. */
  readonly id: string;
  /** The time as every surface writes one: "11:30 am". */
  readonly label: string;
  readonly open: boolean;
}

export interface TimePeriod {
  /** "Morning". */
  readonly name: string;
  readonly times: readonly TimeOption[];
}

export function TimeChoice(props: {
  /** The radios' name, one per form. */
  readonly name: string;
  readonly periods: readonly TimePeriod[];
  readonly chosen: string | null;
  /** Said under a period with nothing open. */
  readonly fullWord: string;
  /** Read after a taken time, which is struck through on the screen. */
  readonly takenWord: string;
  /** The heading above it, which names the choice. */
  readonly labelledBy: string;
  readonly onChoose: (id: string) => void;
  readonly className?: string | undefined;
}) {
  return (
    <div className={classes(styles.periods, props.className)} role="radiogroup" aria-labelledby={props.labelledBy}>
      {props.periods
        .filter((period) => period.times.length > 0)
        .map((period) => (
          <div key={period.name} className={styles.period}>
            <p className={styles.name}>{period.name}</p>
            {period.times.every((time) => !time.open) && <p className={styles.full}>{props.fullWord}</p>}
            <div className={styles.times}>
              {period.times.map((time) => (
                <label
                  key={time.id}
                  className={classes(styles.time, !time.open && styles.taken, time.id === props.chosen && styles.on)}
                >
                  <input
                    className={styles.radio}
                    type="radio"
                    name={props.name}
                    value={time.id}
                    checked={time.id === props.chosen}
                    disabled={!time.open}
                    onChange={() => {
                      props.onChoose(time.id);
                    }}
                  />
                  {time.label}
                  {!time.open && <VisuallyHidden>{`, ${props.takenWord}`}</VisuallyHidden>}
                </label>
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}
