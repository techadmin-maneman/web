// A form's fields at fault, found for the visitor: on a phone the button is screens below the address, so after a
// check or a refusal marks fields, the first of them is brought into view and focused.

import { useEffect, useState } from "preact/hooks";

export type FormRef = { current: HTMLFormElement | null };

/** Brings the form's first field marked invalid into view, and focuses it. */
function focusFirstInvalid(form: HTMLFormElement): void {
  const first = form.querySelector<HTMLElement>('[aria-invalid="true"]');
  if (first === null) return;
  first.scrollIntoView({ block: "center" });
  first.focus({ preventScroll: true });
}

/** Returns what to call once fields are marked: the first is focused when the marks have been drawn. */
export function useInvalidFocus(form: FormRef): () => void {
  const [asked, setAsked] = useState(0);

  useEffect(() => {
    if (asked > 0 && form.current !== null) focusFirstInvalid(form.current);
  }, [asked, form]);

  return () => {
    setAsked((count) => count + 1);
  };
}
