// A filter that is on, as a chip with a way to take it off: "Client · 2c41a8f0 ×".

import type { ReactNode } from "react";
import { classes } from "./classes.ts";
import styles from "./chip.module.css";

export function Chip({
  children,
  removeLabel,
  onRemove,
  className,
}: {
  readonly children: ReactNode;
  /** The remove button's name, which says what it takes off. */
  readonly removeLabel: string;
  readonly onRemove: () => void;
  readonly className?: string | undefined;
}) {
  return (
    <span className={classes(styles.chip, className)}>
      {children}
      <button type="button" className={styles.remove} aria-label={removeLabel} onClick={onRemove}>
        ×
      </button>
    </span>
  );
}
