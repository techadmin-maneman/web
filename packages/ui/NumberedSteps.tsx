// A short list in its order: each line beside its number in the serif, muted. The client app's what to expect, what a
// replacement involves, and how a referral works.

import { classes } from "./classes.ts";
import styles from "./numbered-steps.module.css";

export function NumberedSteps({ steps, className }: { steps: readonly string[]; className?: string | undefined }) {
  return (
    <ol className={classes(styles.steps, className)}>
      {steps.map((step, index) => (
        <li key={step} className={styles.step}>
          <span className={styles.number} aria-hidden="true">
            {index + 1}
          </span>
          <span>{step}</span>
        </li>
      ))}
    </ol>
  );
}
