// The code's six boxes (board A2), as one labelled field: assistive technology
// sees a single input, and the boxes only draw what is typed into it.

import { ONE_TIME_CODE } from "../../../../src/policy/one-time-code.ts";
import type { Ref } from "react";
import styles from "./CodeField.module.css";

interface Props {
  readonly value: string;
  readonly label: string;
  readonly invalid: boolean;
  readonly onChange: (value: string) => void;
  /** The input itself, so the screen can put focus back in it after a wrong code. */
  readonly ref?: Ref<HTMLInputElement>;
}

export function CodeField({ value, label, invalid, onChange, ref }: Props) {
  return (
    <div className={styles.field} data-invalid={invalid}>
      <input
        ref={ref}
        className={styles.input}
        value={value}
        onChange={(event) => {
          onChange(event.target.value.replace(/\D/g, "").slice(0, ONE_TIME_CODE.digits));
        }}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={ONE_TIME_CODE.digits}
        aria-label={label}
        aria-invalid={invalid}
        autoFocus
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
