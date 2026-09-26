// A sheet that rises from the foot of the column (docs/prompts/phase2-frontend.md,
// "Motion"): a booking's steps, a photograph to download, a question before a
// tap that cannot be taken back. It is a native modal <dialog> the width of the
// column and the height of the screen, clear but for what the caller draws at
// its foot, over the ink the boards draw behind a sheet.
//
// It opens as it is drawn and closes as it leaves the page (./useModal.ts). A
// caller that closes it itself -- Close, Done -- keeps a ref to it.

import { useRef, type ReactNode, type RefObject } from "react";
import { classes } from "./classes.ts";
import { useModal } from "./useModal.ts";
import styles from "./sheet.module.css";

export function Sheet({
  ref,
  labelledBy,
  rises = true,
  outsideTapCloses = true,
  onClose,
  onCancel,
  children,
}: {
  /** The caller's own ref, to close the sheet from inside it. */
  readonly ref?: RefObject<HTMLDialogElement | null>;
  /** The id of the sheet's heading, which names it. */
  readonly labelledBy: string;
  /** False for a sheet that is simply there, as the technician app's questions are: its board draws no motion. */
  readonly rises?: boolean;
  /** False where a tap on the ground around the sheet should do nothing, as on a question that wants an answer. */
  readonly outsideTapCloses?: boolean;
  /** The sheet has closed: by the caller, by Escape or a phone's Back, or by a tap around it. Not as it leaves the page. */
  readonly onClose?: () => void;
  /** Escape or a phone's Back, where they are an answer rather than a close: "No" on a question. */
  readonly onCancel?: () => void;
  readonly children: ReactNode;
}) {
  const own = useRef<HTMLDialogElement>(null);
  const dialog = ref ?? own;
  const leaving = useModal(dialog);

  return (
    <dialog
      ref={dialog}
      className={classes(styles.frame, rises && styles.rises)}
      aria-labelledby={labelledBy}
      onCancel={
        onCancel === undefined
          ? undefined
          : (event) => {
              event.preventDefault();
              onCancel();
            }
      }
      onClose={(event) => {
        // A close that arrives once the sheet is open again is stale: the caller stepped out of the way and back.
        if (leaving.current || event.currentTarget.open) return;
        onClose?.();
      }}
      onClick={(event) => {
        if (outsideTapCloses && event.target === event.currentTarget) event.currentTarget.close();
      }}
    >
      {children}
    </dialog>
  );
}
