// The code's six boxes (board A2), as one labelled field: assistive technology
// sees a single input, and the boxes only draw what is typed into it.

import styles from "./CodeField.module.css";

interface Props {
  readonly value: string;
  readonly label: string;
  readonly invalid: boolean;
  readonly onChange: (value: string) => void;
}

export function CodeField({ value, label, invalid, onChange }: Props) {
  return (
    <div className={styles.field} data-invalid={invalid}>
      <input
        className={styles.input}
        value={value}
        onChange={(event) => {
          onChange(event.target.value.replace(/\D/g, "").slice(0, 6));
        }}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        aria-label={label}
        aria-invalid={invalid}
        autoFocus
      />
      <div className={styles.boxes} aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className={styles.box} data-next={index === value.length}>
            {value[index] ?? (index === value.length ? <span className={styles.caret} /> : null)}
          </div>
        ))}
      </div>
    </div>
  );
}
