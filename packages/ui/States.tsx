// A page's data on its way, and a page whose data did not come. The client app's
// design draws both; the others follow its shapes. Each app gives them
// its words, its ground and its own class for the spacing its design draws.

import type { ReactNode } from "react";
import { Button, type ButtonVariant } from "./Button.tsx";
import { classes } from "./classes.ts";
import { VisuallyHidden } from "./VisuallyHidden.tsx";
import styles from "./states.module.css";

/** The shape of a label and a card while the data comes, and the word for it, said once. */
export function Loading({
  label,
  ground = "paper",
  className,
}: {
  label: string;
  ground?: "paper" | "ink";
  className?: string;
}) {
  const shade = ground === "ink" ? styles.onInk : styles.onPaper;
  return (
    <div className={classes(styles.loading, className)} role="status">
      <VisuallyHidden>{label}</VisuallyHidden>
      <div className={classes(styles.line, shade)} />
      <div className={classes(styles.card, shade)} />
    </div>
  );
}

/** One line saying the data did not come, said at once, and a way to try again. */
export function Failed({
  message,
  retry,
  onRetry,
  button = "outline",
  polite = false,
  className,
  messageClassName,
  retryClassName,
  reference = null,
}: {
  message: string;
  retry: string;
  onRetry: () => void;
  /** The retry's look: outlined by default, on the ground the app draws. */
  button?: ButtonVariant;
  /** Said when the reader is next free rather than at once: a page waiting for the connection, which is no fault. */
  polite?: boolean;
  className?: string;
  messageClassName?: string;
  retryClassName?: string;
  /** The failed call's reference (./ErrorRef.tsx), under the line. */
  reference?: ReactNode;
}) {
  return (
    <div className={classes(styles.failed, className)} role={polite ? "status" : "alert"}>
      <p className={classes(styles.message, messageClassName)}>{message}</p>
      {reference}
      <Button variant={button} size="small" className={retryClassName} onClick={onRetry}>
        {retry}
      </Button>
    </div>
  );
}
