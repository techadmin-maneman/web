// The check before a change is sent: what it was beside what it will be, and
// only the second press sends it (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).
// It takes the focus as it opens, so it is read at once and never opens out of
// sight (FEO-15). The price form draws its own; the consumables, the job sheet
// and the stock share this one (docs/decisions/0087-consumables-and-stock.md).

import { Button } from "@maneman/ui/Button";
import { useEffect, useId, useRef } from "react";
import styles from "./settings.module.css";

interface Props {
  readonly title: string;
  /** Each change, the old beside the new. */
  readonly lines: readonly string[];
  /** What the change does that ops may not mean, in oxblood. */
  readonly warnings?: readonly string[];
  readonly send: string;
  readonly sending: string;
  readonly back: string;
  readonly busy: boolean;
  /** False when there is nothing to send: the lines then say so. */
  readonly ready?: boolean;
  readonly onSend: () => void;
  readonly onBack: () => void;
}

export function CheckPanel({
  title,
  lines,
  warnings = [],
  send,
  sending,
  back,
  busy,
  ready = true,
  onSend,
  onBack,
}: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    panel.current?.focus();
  }, []);
  return (
    <div className={styles.check} ref={panel} tabIndex={-1} role="group" aria-labelledby={titleId}>
      <p className={styles.checkTitle} id={titleId}>
        {title}
      </p>
      {lines.map((line) => (
        <p className={styles.checkLine} key={line}>
          {line}
        </p>
      ))}
      {warnings.map((line) => (
        <p className={styles.checkWarning} key={line}>
          {line}
        </p>
      ))}
      <div className={styles.actions}>
        <Button variant="primary" size="small" className={styles.save} disabled={busy || !ready} onClick={onSend}>
          {busy ? sending : send}
        </Button>
        <Button variant="outline" size="small" className={styles.quiet} disabled={busy} onClick={onBack}>
          {back}
        </Button>
      </div>
    </div>
  );
}
