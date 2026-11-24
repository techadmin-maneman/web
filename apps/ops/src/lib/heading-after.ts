// A list a row leaves once decided in its drawer: the keyboard goes to the list's heading once the drawer has closed,
// since the row and the button that opened the drawer are gone, and a modal drawer still open keeps the page inert.

import { useEffect, useState, type RefObject } from "react";

/** Answers a call to make, with the row decided, that moves the keyboard to `heading` once the drawer has closed. */
export function useHeadingAfter(heading: RefObject<HTMLHeadingElement | null>): (id: string) => void {
  const [last, setLast] = useState<string | null>(null);
  useEffect(() => {
    if (last === null) return;
    const frame = requestAnimationFrame(() => heading.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [heading, last]);
  return setLast;
}
