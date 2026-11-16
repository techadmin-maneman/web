// A wait with no end the screen can name, as a payment being confirmed: a ring turning, beside the words that say what
// is awaited, which a screen reader hears instead. Under reduced motion it stands still.

import { classes } from "./classes.ts";
import styles from "./spinner.module.css";

export function Spinner({ className }: { readonly className?: string | undefined }) {
  return <span className={classes(styles.spinner, className)} aria-hidden="true" />;
}
