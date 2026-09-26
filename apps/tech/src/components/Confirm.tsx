// A question asked before a tap that cannot be taken back: closing a job as a
// no-show, which can bring the client a charge, and deleting work the phone
// has not sent. A modal dialog, so the rest of the screen cannot be reached
// until it is answered, and the way back is at the foot, where a thumb is.
//
// Neither answer is gold: the screen's one primary action is behind it.

import { Button } from "@maneman/ui/Button";
import { useEffect, useId, useRef } from "react";
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
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const shown = dialog.current;
    shown?.showModal();
    return () => {
      shown?.close();
    };
  }, []);

  return (
    <dialog
      className={styles.sheet}
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        // Escape, or a phone's back gesture: the same as saying no.
        event.preventDefault();
        onNo();
      }}
    >
      <h2 className={styles.title} id={titleId}>
        {title}
      </h2>
      <p className={styles.body}>{body}</p>
      <Button variant="outlineOnInk" size="action" className={styles.yes} onClick={onYes}>
        {yes}
      </Button>
      <Button variant="outlineOnInk" size="action" className={styles.no} onClick={onNo}>
        {no}
      </Button>
    </dialog>
  );
}
