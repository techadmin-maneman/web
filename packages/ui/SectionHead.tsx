// A section's head, as the technician app's white ground draws one (docs/prompts/tech-redesign.md): its title under
// a rule in the strong ink, with one action or a figure at the line's end. The rule, not a box, sets a section apart.

import type { ReactNode } from "react";
import { classes } from "./classes.ts";
import styles from "./section-head.module.css";

export function SectionHead({
  title,
  level = 2,
  size = "section",
  ruled = true,
  end,
  id,
  className,
}: {
  readonly title: ReactNode;
  /** Its heading's level in the screen's outline. */
  readonly level?: 2 | 3;
  /** A section's title, or a list's smaller one, as "Later today". */
  readonly size?: "section" | "list";
  /** Under the rule, or, where the screen's head is just above it, without one. */
  readonly ruled?: boolean;
  /** One action, as "Day view", or a figure, at the line's end. */
  readonly end?: ReactNode;
  /** For the section it names, by aria-labelledby. */
  readonly id?: string;
  readonly className?: string | undefined;
}) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <div className={classes(styles.head, ruled ? styles.ruled : styles.bare, className)}>
      <Heading id={id} className={styles[size]}>
        {title}
      </Heading>
      {end !== undefined && <span className={styles.end}>{end}</span>}
    </div>
  );
}
