// One of a few to show, pressed while it is shown: the angle a comparison is drawn at, or a filter with how many it
// shows. On the ink or on paper. A choice may carry a quieter line beneath its words.

import { quantity } from "@maneman/web-kit/figures";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { classes } from "./classes.ts";
import styles from "./toggle-button.module.css";

export function ToggleButton({
  pressed,
  onInk = false,
  asRadio = false,
  filled = false,
  count,
  sub,
  className,
  children,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "aria-pressed" | "role" | "aria-checked"> & {
  readonly pressed: boolean;
  readonly onInk?: boolean;
  /** One of a few, only one of which may be chosen: said as a radio, checked, rather than pressed. */
  readonly asRadio?: boolean;
  /** Chosen, filled in ink rather than edged in it: the console's chips and filters. */
  readonly filled?: boolean;
  /** How many it shows, after its words: a filter's. */
  readonly count?: number | undefined;
  /** A quieter line beneath its words: what a choice means, or who does what next. */
  readonly sub?: ReactNode;
}) {
  const said = asRadio ? { role: "radio", "aria-checked": pressed } : { "aria-pressed": pressed };
  return (
    <button
      {...rest}
      {...said}
      type="button"
      className={classes(styles.toggle, onInk ? styles.onInk : styles.onPaper, filled && styles.filled, className)}
    >
      {sub === undefined ? (
        children
      ) : (
        <span className={styles.lines}>
          <span>{children}</span>
          <span className={styles.sub}>{sub}</span>
        </span>
      )}
      {count !== undefined && <span className={styles.count}>{quantity(count)}</span>}
    </button>
  );
}
