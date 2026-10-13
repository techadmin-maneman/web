// A setting that is on or off, as a consent: a switch, said to a screen reader as one, named by the words beside it.

import { classes } from "./classes.ts";
import styles from "./switch.module.css";

export function Switch({
  checked,
  onToggle,
  labelledBy,
  disabled,
  className,
}: {
  readonly checked: boolean;
  readonly onToggle: () => void;
  /** The id of the words that name it. */
  readonly labelledBy: string;
  readonly disabled?: boolean;
  readonly className?: string | undefined;
}) {
  return (
    <button
      type="button"
      role="switch"
      className={classes(styles.switch, className)}
      aria-checked={checked}
      aria-labelledby={labelledBy}
      disabled={disabled}
      onClick={onToggle}
    >
      <span className={styles.knob} />
    </button>
  );
}
