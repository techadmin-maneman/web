// The check before a change is sent: what it was beside what it will be, and
// only the second press sends it (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).
// It takes the focus as it opens, so it is read at once and never opens out of
// sight (FEO-15). Every setting's form shares it, as do the stock and a
// technician's leave (docs/decisions/0087-consumables-and-stock.md).

import { Button } from "@maneman/ui/Button";
import { useEffect, useId, useRef, type ReactNode } from "react";
import styles from "./settings.module.css";

interface Props {
  /** The check's heading. Without one, its first line names it, as taking a price back does. */
  readonly title?: string;
  /** Each change, the old beside the new. */
  readonly lines?: readonly string[];
  /** What the change does that ops may not mean, in oxblood. */
  readonly warnings?: readonly string[];
  /** What lines alone cannot say, under them: a list of every figure a rule moves, say. */
  readonly children?: ReactNode;
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
  lines = [],
  warnings = [],
  children,
  send,
  sending,
  back,
  busy,
  ready = true,
  onSend,
  onBack,
}: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const nameId = useId();
  useEffect(() => {
    panel.current?.focus();
  }, []);
  return (
    <div className={styles.check} ref={panel} tabIndex={-1} role="group" aria-labelledby={nameId}>
      {title !== undefined && (
        <p className={styles.checkTitle} id={nameId}>
          {title}
        </p>
      )}
      {lines.map((line, index) => (
        <p className={styles.checkLine} key={line} id={title === undefined && index === 0 ? nameId : undefined}>
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
