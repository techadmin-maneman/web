// Something wrong that the reader has to deal with (docs/prompts/tech-redesign.md): a job that could not send, a step
// ops sent back, a refusal. Edged in the error's colour, its title in it and what to do beneath. Where a tap opens
// what is wrong, the card is that button. A card that answers what was just done is said at once (`live`); one that is
// there when a screen opens, as Today's, is read where it stands.

import type { ReactNode } from "react";
import { classes } from "./classes.ts";
import styles from "./problem-card.module.css";

export function ProblemCard({
  title,
  onOpen,
  live = false,
  className,
  children,
}: {
  readonly title: ReactNode;
  /** Opens what is wrong, as a job that could not send; none where the card says all there is. */
  readonly onOpen?: () => void;
  /**
   * Said the moment it appears, as a step refused on Next; not for a card a screen opens with. A card a tap opens is a
   * button, which is never said as an alert, so `live` counts only without `onOpen`.
   */
  readonly live?: boolean;
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
      <div className={classes(styles.card, className)} role={live ? "alert" : undefined}>
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
