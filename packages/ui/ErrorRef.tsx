// What a person quotes when they say a screen failed: the start of the API's ID for the call, which every line the
// API logged of that call carries, and a button that copies the whole ID.

import { useState } from "react";
import { classes } from "./classes.ts";
import styles from "./error-ref.module.css";

/** As many characters as a person reads out or types without a slip, and enough to find the one call. */
const SHOWN = 8;

export interface ErrorRefWords {
  /** Before the reference, as "Ref". */
  readonly label: string;
  readonly copy: string;
  readonly copied: string;
}

/** False where the page may not write to the clipboard. */
async function copied(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function ErrorRef({
  requestId,
  words,
  className,
}: {
  requestId: string;
  words: ErrorRefWords;
  className?: string;
}) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    setDone(await copied(requestId));
  };
  return (
    <p className={classes(styles.ref, className)}>
      <span>
        {words.label} <span className={styles.id}>{requestId.slice(0, SHOWN)}</span>
      </span>
      <button type="button" className={styles.copy} onClick={() => void copy()}>
        {done ? words.copied : words.copy}
      </button>
    </p>
  );
}
