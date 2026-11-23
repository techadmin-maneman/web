import { useEffect, useRef } from "react";

/**
 * The focus for a question asked in place of the button that asked it, as "Let it go?" or "Cancel this order?".
 * Asked, the question is brought into view, clear of any bar over the foot of what scrolls by its own
 * scroll-margin, and its safe answer takes the focus; answered by that safe answer, or refused, the focus goes back
 * to the button that asked.
 */
export function useAskFocus(asking: boolean) {
  const opener = useRef<HTMLButtonElement>(null);
  const question = useRef<HTMLDivElement>(null);
  const safe = useRef<HTMLButtonElement>(null);
  const asked = useRef(false);
  useEffect(() => {
    if (asking) {
      question.current?.scrollIntoView({ block: "nearest" });
      safe.current?.focus({ preventScroll: true });
    } else if (asked.current) opener.current?.focus();
    asked.current = asking;
  }, [asking]);
  return { opener, question, safe };
}
