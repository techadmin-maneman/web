// One of a few to show, pressed while it is shown: the angle a comparison is drawn at. On the ink or on paper.

import type { ButtonHTMLAttributes } from "react";
import { classes } from "./classes.ts";
import styles from "./toggle-button.module.css";

export function ToggleButton({
  pressed,
  onInk = false,
  asRadio = false,
  className,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "aria-pressed" | "role" | "aria-checked"> & {
  readonly pressed: boolean;
  readonly onInk?: boolean;
  /** One of a few, only one of which may be chosen: said as a radio, checked, rather than pressed. */
  readonly asRadio?: boolean;
}) {
  const said = asRadio ? { role: "radio", "aria-checked": pressed } : { "aria-pressed": pressed };
  return (
    <button
      {...rest}
      {...said}
      type="button"
      className={classes(styles.toggle, onInk ? styles.onInk : styles.onPaper, className)}
    />
  );
}
