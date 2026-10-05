// A panel that opens over the page as a native modal <dialog>, as the ops
// console's drawer and move picker do: the page behind it is inert and the
// keyboard stays inside it. The panel takes the keyboard itself as it
// opens, so its name is read before its first control.
//
// Escape asks it to close, and the caller decides whether it may: not while a
// move is being sent, or the same job could be sent twice. A browser
// that closes it anyway, as one may on a second Escape, finds it opened again
// for as long as the caller still draws it.

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { useModal } from "./useModal.ts";

export function Dialog({
  labelledBy,
  className,
  canClose,
  onDismiss,
  children,
}: {
  readonly labelledBy: string;
  /** The panel's own look: its width, its place, its ground. */
  readonly className: string | undefined;
  readonly canClose: boolean;
  readonly onDismiss: () => void;
  readonly children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const leaving = useModal(dialog);

  useLayoutEffect(() => {
    dialog.current?.focus();
  }, []);

  return (
    <dialog
      ref={dialog}
      className={className}
      aria-labelledby={labelledBy}
      tabIndex={-1}
      onCancel={(event) => {
        event.preventDefault();
        if (canClose) onDismiss();
      }}
      onClose={(event) => {
        const closed = event.currentTarget;
        if (!leaving.current && closed.isConnected && !closed.open) closed.showModal();
      }}
    >
      {children}
    </dialog>
  );
}
