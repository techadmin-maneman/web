// A page's data on its way, and a page whose data did not come. Board B3 draws
// both for the client app; the others follow its shapes. Each app gives them
// its words, its ground and its own class for the spacing its boards draw.

import { Button, type ButtonVariant } from "./Button.tsx";
import { classes } from "./classes.ts";
import { VisuallyHidden } from "./VisuallyHidden.tsx";
import styles from "./states.module.css";

/** The shape of a label and a card while the data comes (board B3), and the word for it, said once. */
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
  className,
  messageClassName,
}: {
  message: string;
  retry: string;
  onRetry: () => void;
  /** The retry's look: outlined by default, on the ground the app draws. */
  button?: ButtonVariant;
  className?: string;
  messageClassName?: string;
}) {
  return (
    <div className={classes(styles.failed, className)} role="alert">
      <p className={classes(styles.message, messageClassName)}>{message}</p>
      <Button variant={button} size="small" onClick={onRetry}>
        {retry}
      </Button>
    </div>
  );
}
