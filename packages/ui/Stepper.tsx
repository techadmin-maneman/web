// A count to set a step at a time (docs/prompts/tech-redesign.md, "Consumables"): minus, the figure, plus. It stops at
// its least and its most, each key named for what it does to what, and the figure said whenever it changes. A key at
// its limit says it is unavailable but keeps the keyboard's focus. A screen may put its own figure in the middle, as
// one that can be typed.

import { ICONS } from "@maneman/brand/icons";
import { useId, type ReactNode } from "react";
import { classes } from "./classes.ts";
import { Icon } from "./Icon.tsx";
import { VisuallyHidden } from "./VisuallyHidden.tsx";
import styles from "./stepper.module.css";

/** How far a key moves the count, and the least and the most it may reach. */
export interface Steps {
  readonly step: number;
  readonly min: number;
  readonly max: number;
}

/** `value` moved one step, kept between the least and the most. */
export function stepped(value: number, by: 1 | -1, { step, min, max }: Steps): number {
  return Math.min(max, Math.max(min, value + by * step));
}

export function Stepper({
  value,
  onChange,
  step = 1,
  min = 0,
  max = Number.POSITIVE_INFINITY,
  lessLabel,
  moreLabel,
  said,
  figure,
  className,
}: {
  readonly value: number;
  readonly onChange: (value: number) => void;
  readonly step?: number;
  readonly min?: number;
  readonly max?: number;
  /** What each key does, for a screen reader: "One less tape strip". */
  readonly lessLabel: string;
  readonly moreLabel: string;
  /** The count in words, said as it changes: "Tape strips, 3". */
  readonly said: string;
  /** The figure itself, where the screen draws its own; the value otherwise. */
  readonly figure?: ReactNode;
  readonly className?: string | undefined;
}) {
  const saidId = useId();
  const change = (by: 1 | -1) => {
    const next = stepped(value, by, { step, min, max });
    if (next !== value) onChange(next);
  };
  return (
    <span className={classes(styles.stepper, className)}>
      <button
        type="button"
        className={styles.key}
        aria-label={lessLabel}
        aria-describedby={saidId}
        aria-disabled={value <= min}
        onClick={() => {
          change(-1);
        }}
      >
        <Icon d={ICONS.minus} size="sm" />
      </button>
      {figure ?? (
        <span className={styles.figure} aria-hidden="true">
          {value}
        </span>
      )}
      <button
        type="button"
        className={styles.key}
        aria-label={moreLabel}
        aria-describedby={saidId}
        aria-disabled={value >= max}
        onClick={() => {
          change(1);
        }}
      >
        <Icon d={ICONS.plus} size="sm" />
      </button>
      <VisuallyHidden id={saidId} role="status">
        {said}
      </VisuallyHidden>
    </span>
  );
}
