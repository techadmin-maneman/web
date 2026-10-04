// A question asked before a tap that cannot be taken back: closing a job as a
// no-show, which can bring the client a charge, and deleting work the phone
// has not sent. A sheet, so the rest of the screen cannot be reached until it
// is answered, and the way back is at the foot, where a thumb is. Escape or a
// phone's back gesture says no; a tap beside it says nothing. It opens on the
// safe answer, so a stray Enter or a tap already on its way keeps the work.
//
// Neither answer is gold: the screen's one primary action is behind it.

import { Button } from "@maneman/ui/Button";
import { Sheet } from "@maneman/ui/Sheet";
import { useId, useLayoutEffect, useRef } from "react";
import styles from "./sheet.module.css";

export function Confirm({
  title,
  body,
  yes,
  no,
  onYes,
  onNo,
}: {
  readonly title: string;
  readonly body: string;
  readonly yes: string;
  readonly no: string;
  readonly onYes: () => void;
  readonly onNo: () => void;
}) {
  const titleId = useId();
  const safe = useRef<HTMLButtonElement>(null);

  // After the sheet has opened, which puts the focus on its first button.
  useLayoutEffect(() => {
    safe.current?.focus();
  }, []);

  return (
    <Sheet labelledBy={titleId} rises={false} outsideTapCloses={false} onCancel={onNo}>
      <div className={styles.sheet}>
        <h2 className={styles.title} id={titleId}>
          {title}
        </h2>
        <p className={styles.body}>{body}</p>
        <Button variant="outlineOnInk" size="action" className={styles.yes} onClick={onYes}>
          {yes}
        </Button>
        <Button ref={safe} variant="outlineOnInk" size="action" className={styles.no} onClick={onNo}>
          {no}
        </Button>
      </div>
    </Sheet>
  );
}
