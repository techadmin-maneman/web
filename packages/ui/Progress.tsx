// How far along something is, drawn as a line (docs/prompts/tech-redesign.md, "Visit engine"): a visit's steps as
// segments, done in the strong ink, the one under way in the brand's metal, the rest on the track; or one line filling,
// as pieces scanned or a wait counting. Neither says anything itself: the words beside it say how far, so a screen
// reader hears them once.

import { classes } from "./classes.ts";
import styles from "./progress.module.css";

export type StepState = "done" | "current" | "todo";

const SEGMENT = { done: styles.done, current: styles.current, todo: styles.todo } as const;

export function StepProgress({
  steps,
  className,
}: {
  /** Each step's state, in the visit's order. */
  readonly steps: readonly StepState[];
  readonly className?: string | undefined;
}) {
  return (
    <span className={classes(styles.steps, className)} aria-hidden="true">
      {steps.map((state, index) => (
        <span key={index} className={classes(styles.segment, SEGMENT[state])} data-state={state} />
      ))}
    </span>
  );
}

/** Each step's state when the steps go in order and `current` (from 0) is the one under way; past the end, all done. */
export function stepStates(total: number, current: number): StepState[] {
  return Array.from({ length: total }, (_, index) => {
    if (index < current) return "done";
    return index === current ? "current" : "todo";
  });
}

/** A line filling to `value`, a share from 0 to 1: the strong ink, or the metal for the one thing a screen marks. */
export function ProgressLine({
  value,
  tone = "strong",
  className,
}: {
  readonly value: number;
  readonly tone?: "strong" | "accent";
  readonly className?: string | undefined;
}) {
  const share = Math.min(1, Math.max(0, value));
  return (
    <span className={classes(styles.track, className)} aria-hidden="true">
      <progress className={classes(styles.fill, tone === "accent" && styles.accent)} value={share} max={1} />
    </span>
  );
}
