// A one-time code's boxes (board A2), as one labelled field: assistive technology sees a single input, and the boxes
// only draw what is typed into it. The client app's login and the technician app's draw it; each sets its boxes'
// height and gap with --code-box-height and --code-box-gap on its own class.

import type { Ref } from "react";
import { ONE_TIME_CODE } from "../../src/policy/one-time-code.ts";
import { classes } from "./classes.ts";
import styles from "./code-field.module.css";

/** What was typed, as a code: its digits alone, no more of them than a code has. */
export const codeDigits = (typed: string): string => typed.replace(/\D/g, "").slice(0, ONE_TIME_CODE.digits);

interface Props {
  readonly value: string;
  readonly label: string;
  readonly invalid?: boolean;
  readonly disabled?: boolean;
  /** Whether the keyboard starts in it, as it does on a screen that asks for nothing else. */
  readonly autoFocus?: boolean;
  readonly className?: string;
  readonly onChange: (value: string) => void;
  /** The input itself, so a screen can put focus back in it after a wrong code. */
  readonly ref?: Ref<HTMLInputElement>;
}

export function CodeField({ value, label, invalid = false, disabled, autoFocus, className, onChange, ref }: Props) {
  return (
    <div className={classes(styles.field, className)} data-invalid={invalid}>
      <input
        ref={ref}
        className={styles.input}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          onChange(codeDigits(event.target.value));
        }}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={ONE_TIME_CODE.digits}
        aria-label={label}
        aria-invalid={invalid}
        autoFocus={autoFocus}
      />
      <div className={styles.boxes} aria-hidden="true">
        {Array.from({ length: ONE_TIME_CODE.digits }, (_, index) => (
          <div key={index} className={styles.box} data-next={index === value.length}>
            {value[index] ?? (index === value.length ? <span className={styles.caret} /> : null)}
          </div>
        ))}
      </div>
    </div>
  );
}
