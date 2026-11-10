// Something wrong that the reader has to deal with (docs/prompts/tech-redesign.md): a job that could not send, a step
// ops sent back, a refusal. Edged in the error's colour, its title in it and what to do beneath. Where a tap opens
// what is wrong, the card is that button; otherwise it is said at once.

import type { ReactNode } from "react";
import { classes } from "./classes.ts";
import styles from "./problem-card.module.css";

export function ProblemCard({
  title,
  onOpen,
  className,
  children,
}: {
  readonly title: ReactNode;
  /** Opens what is wrong, as a job that could not send; none where the card says all there is. */
  readonly onOpen?: () => void;
  readonly className?: string | undefined;
  /** What happened and what to do, in a line or two. */
  readonly children?: ReactNode;
}) {
  const body = (
    <>
      <span className={styles.title}>{title}</span>
      {children !== undefined && <span className={styles.body}>{children}</span>}
    </>
  );
  if (onOpen === undefined) {
    return (
      <div className={classes(styles.card, className)} role="alert">
        {body}
      </div>
    );
  }
  return (
    <button type="button" className={classes(styles.card, styles.opens, className)} onClick={onOpen}>
      {body}
    </button>
  );
}
