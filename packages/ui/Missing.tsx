// What a disabled action waits for, said in one line beneath it (docs/prompts/client-redesign.md, "Copy"): the action
// names the line as its description, so a screen reader hears why it does nothing yet. Nothing while it can act. Its id
// is the screen's to give, one a page or sheet holds once.
//
//   <Button disabled={chosen === null} aria-describedby={describedBy("pick-date", chosen === null)}>Continue</Button>
//   <Missing id="pick-date" what={chosen === null ? copy.pickDate : null} />

import { classes } from "./classes.ts";
import styles from "./missing.module.css";

export function Missing({
  id,
  what,
  className,
}: {
  readonly id: string;
  readonly what: string | null;
  readonly className?: string;
}) {
  if (what === null) return null;
  return (
    <p id={id} className={classes(styles.missing, className)}>
      {what}
    </p>
  );
}

/** The action's description while it waits: the line's id, or none once it can act. */
export const describedBy = (id: string, waiting: boolean): string | undefined => (waiting ? id : undefined);
