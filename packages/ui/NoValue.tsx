// A value not there to give, in a table's cell or a record's line: a muted dash, said aloud as "None". Every screen
// writes a gap this way, never in words of its own ("Not known", "None booked") beside the values that are there.

import { states } from "./words.ts";
import styles from "./no-value.module.css";

export function NoValue() {
  return (
    <span className={styles.gap}>
      <span aria-hidden="true">—</span>
      <span className={styles.spoken}>{states.none}</span>
    </span>
  );
}
