// A line of a checklist on the ink, as the technician app's service checklist is: the whole row is the control, its
// box ticked and its words quietened once done. Pressed, rather than checked, so a screen reader says what it does.

import type { ReactNode } from "react";
import { GLYPHS } from "@maneman/brand/icons";
import { Icon } from "./Icon.tsx";
import { classes } from "./classes.ts";
import styles from "./check-row.module.css";

export function CheckRow({
  done,
  onToggle,
  tickStroke,
  children,
}: {
  readonly done: boolean;
  readonly onToggle: () => void;
  /** The tick's weight, heavier than the icons' own where the app draws it so. */
  readonly tickStroke?: number;
  readonly children: ReactNode;
}) {
  return (
    <button type="button" className={styles.row} aria-pressed={done} onClick={onToggle}>
      <span className={classes(styles.box, done && styles.boxDone)}>
        {done && <Icon d={GLYPHS.check} size={22} stroke={tickStroke} />}
      </span>
      <span className={classes(styles.words, done && styles.wordsDone)}>{children}</span>
    </button>
  );
}
