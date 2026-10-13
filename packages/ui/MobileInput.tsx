// An Indian mobile number to type: the country's +91 drawn before the box, the digits in figures of one width. On the
// ink, as sign-in draws it, or on paper, as a new number is asked for.

import type { InputHTMLAttributes } from "react";
import { classes } from "./classes.ts";
import styles from "./mobile-input.module.css";

export function MobileInput({
  prefix,
  onInk = false,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "inputMode" | "autoComplete"> & {
  /** "+91", in the app's words. */
  readonly prefix: string;
  readonly onInk?: boolean;
}) {
  return (
    <div className={classes(styles.field, onInk ? styles.onInk : styles.onPaper, className)}>
      <span className={styles.prefix} aria-hidden="true">
        {prefix}
      </span>
      <input {...rest} className={styles.input} type="tel" inputMode="numeric" autoComplete="tel-national" />
    </div>
  );
}
