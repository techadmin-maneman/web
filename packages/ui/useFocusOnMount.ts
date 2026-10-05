import { useEffect, useRef, type RefObject } from "react";

/**
 * A ref for an element that takes the keyboard as it first draws: a panel that opens where the button that opened it
 * stood, so it is read at once and never opens out of sight. The element needs tabIndex={-1} unless it is a control.
 */
export function useFocusOnMount<T extends HTMLElement>(): RefObject<T | null> {
  const element = useRef<T>(null);
  useEffect(() => {
    element.current?.focus();
  }, []);
  return element;
}
