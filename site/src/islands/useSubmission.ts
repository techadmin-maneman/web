// What a form that sends a name and number keeps while it sends: whether its fields have been checked, the line it
// says for a refusal, the fields a refusal named, and one key per request, so pressing again after a lost answer is
// the same request. The booking forms (./invite/useTurnstileForm.ts) and the try-on's gate (./tryon/useGate.ts) both
// send this way.

import { useMemo, useRef, useState } from "preact/hooks";
import type { Code } from "../lib/api.ts";
import { keyPerRequest } from "../lib/idempotency.ts";
import { useInvalidFocus } from "./useInvalidFocus.ts";

/** `marks` are the fields, by the API's names, the form marks itself when a refusal names them. */
export function useSubmission(marks: readonly string[]) {
  const [touched, setTouched] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // The fields the last refusal named that the form marks.
  const [refusedFields, setRefusedFields] = useState<readonly string[]>([]);
  const form = useRef<HTMLFormElement>(null);
  const showInvalid = useInvalidFocus(form);
  const keyFor = useMemo(keyPerRequest, []);

  /** The form checked and found wanting: its fields marked, the first focused, and no refusal said. */
  function stopAtFields() {
    setTouched(true);
    setFailure(null);
    showInvalid();
  }

  /** A request about to go: what the last refusal said no longer stands. */
  function starting() {
    setFailure(null);
    setRefusedFields([]);
  }

  /** A refusal that names fields the form marks marks them and focuses the first; false where it names none. */
  function markRefused(code: Code, named: readonly string[]): boolean {
    if (code === "invalid_request") setTouched(true);
    const marked = named.filter((field) => marks.includes(field));
    setRefusedFields(marked);
    if (marked.length === 0) return false;
    setFailure(null);
    showInvalid();
    return true;
  }

  /** The fields changed since a refusal named them, which are no longer marked. */
  function unmark(changed: (field: string) => boolean) {
    setRefusedFields((refused) => refused.filter((field) => !changed(field)));
  }

  return { touched, failure, setFailure, refusedFields, form, keyFor, stopAtFields, starting, markRefused, unmark };
}
