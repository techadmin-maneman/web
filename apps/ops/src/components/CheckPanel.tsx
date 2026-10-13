// The check before a change is sent: what it was beside what it will be, and
// only the second press sends it (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).
// It takes the focus as it opens, so it is read at once and never opens out of
// sight. Every write in the console that is not a deletion goes through it, in the words of `review`
// (../content/common.ts): a change made in boxes is reviewed and goes back to them to edit; a one-press action asks
// its question and is cancelled.

import { useFocusOnMount } from "@maneman/ui/useFocusOnMount";
import { Button } from "@maneman/ui/Button";
import { useId, type ReactNode } from "react";
import { review } from "../content/common.ts";
import styles from "./forms.module.css";

interface Props {
  /** A one-press action's question, "Pause Acme?"; a change made in boxes is "Review the change". */
  readonly question?: string;
  /** Each change, the old beside the new. */
  readonly lines?: readonly string[];
  /** What the change does that ops may not mean, in oxblood. */
  readonly warnings?: readonly string[];
  /** What lines alone cannot say, under them: a list of every figure a rule moves, say. */
  readonly children?: ReactNode;
  readonly busy: boolean;
  /** False when there is nothing to send: the lines then say so. */
  readonly ready?: boolean;
  readonly onSend: () => void;
  readonly onBack: () => void;
}

export function CheckPanel({
  question,
  lines = [],
  warnings = [],
  children,
  busy,
  ready = true,
  onSend,
  onBack,
}: Props) {
  const panel = useFocusOnMount<HTMLDivElement>();
  const nameId = useId();
  return (
    <div className={styles.check} ref={panel} tabIndex={-1} role="group" aria-labelledby={nameId}>
      <p className={styles.checkTitle} id={nameId}>
        {question ?? review.title}
      </p>
      {lines.map((line) => (
        <p className={styles.checkLine} key={line}>
          {line}
        </p>
      ))}
      {children}
      {warnings.map((line) => (
        <p className={styles.checkWarning} key={line}>
          {line}
        </p>
      ))}
      <div className={styles.actions}>
        <Button variant="primary" size="small" disabled={busy || !ready} onClick={onSend}>
          {busy ? review.sending : review.send}
        </Button>
        <Button variant="outline" size="small" className={styles.quiet} disabled={busy} onClick={onBack}>
          {question === undefined ? review.edit : review.cancel}
        </Button>
      </div>
    </div>
  );
}
