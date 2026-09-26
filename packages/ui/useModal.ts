import { useLayoutEffect, useRef, type RefObject } from "react";

/**
 * Keeps a <dialog> open as a modal for as long as it is drawn: the page behind
 * it is inert and the keyboard stays inside. As it leaves the page it is closed
 * first, so the browser hands the keyboard back to whatever opened it.
 *
 * That last close is the page's, not the person's, so it must not count as
 * one: the answer is true from then on, and a close handler checks it.
 */
export function useModal(dialog: RefObject<HTMLDialogElement | null>): RefObject<boolean> {
  const leaving = useRef(false);
  useLayoutEffect(() => {
    const shown = dialog.current;
    if (shown === null) return undefined;
    leaving.current = false;
    shown.showModal();
    return () => {
      leaving.current = true;
      shown.close();
    };
  }, [dialog]);
  return leaving;
}
