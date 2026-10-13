// A choice among many drawn as a card: what it chooses, small, and what is chosen beneath, as a comparison's two
// visits. The browser's own list opens over it, unseen until tapped, so it reads and works as any select.

import type { ReactNode } from "react";
import { classes } from "./classes.ts";
import styles from "./select-card.module.css";

export function SelectCard({
  label,
  shown,
  value,
  options,
  onInk = false,
  className,
  onChange,
}: {
  /** What it chooses, said to a screen reader as its name too. */
  readonly label: string;
  /** What is chosen, as the card shows it. */
  readonly shown: ReactNode;
  readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly onInk?: boolean;
  readonly className?: string | undefined;
  readonly onChange: (value: string) => void;
}) {
  return (
    <label className={classes(styles.card, onInk && styles.onInk, className)}>
      <span className={styles.label}>{label}</span>
      <span className={styles.shown} aria-hidden="true">
        {shown}
      </span>
      <select
        className={styles.select}
        aria-label={label}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
