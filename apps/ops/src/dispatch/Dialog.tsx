// A panel that opens over the board as a native modal <dialog>: the page
// behind it is inert and the keyboard stays inside it (FEO-13). Escape asks it
// to close, and the board decides whether it may: not while a move is being
// sent, or the same job could be sent twice (FEO-04). A browser that closes it
// anyway, as one may on a second Escape, finds it opened again for as long as
// the board still has it open.

import { useLayoutEffect, useRef, type ReactNode } from "react";

interface Props {
  readonly labelledBy: string;
  readonly className: string | undefined;
  readonly canClose: boolean;
  readonly onDismiss: () => void;
  readonly children: ReactNode;
}

export function Dialog({ labelledBy, className, canClose, onDismiss, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  // Opened as it is drawn, and closed before it leaves the page, so the browser hands the keyboard
  // back to whatever opened it.
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return undefined;
    dialog.showModal();
    // The panel itself takes the keyboard first, so its name is read before its first control.
    dialog.focus();
    return () => {
      dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={className}
      aria-labelledby={labelledBy}
      tabIndex={-1}
      onCancel={(event) => {
        event.preventDefault();
        if (canClose) onDismiss();
      }}
      onClose={(event) => {
        const dialog = event.currentTarget;
        if (dialog.isConnected && !dialog.open) dialog.showModal();
      }}
    >
      {children}
    </dialog>
  );
}
