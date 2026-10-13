// One of a few to show, pressed while it is shown: the angle a comparison is drawn at. On the ink or on paper.

import type { ButtonHTMLAttributes } from "react";
import { classes } from "./classes.ts";
import styles from "./toggle-button.module.css";

export function ToggleButton({
  pressed,
  onInk = false,
  className,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "aria-pressed"> & {
  readonly pressed: boolean;
  readonly onInk?: boolean;
}) {
  return (
    <button
      {...rest}
      type="button"
      aria-pressed={pressed}
      className={classes(styles.toggle, onInk ? styles.onInk : styles.onPaper, className)}
    />
  );
}
