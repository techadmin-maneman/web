// A refusal from the API, said in a screen's own words. An invalid_request may name the boxes it refused
// (`fields`): "unit_cost", or a line of a list, "items.2.label"; its words are looked up by the box's own name, then
// by the list's, then by the code. Anything else is looked up by its code. Where none of those has words, the
// screen's catch-all, `unknown`, says it.

export interface Failure {
  readonly code: string;
  readonly fields?: readonly string[];
}

export function errorText(errors: Readonly<Record<string, string | undefined>>, failure: Failure): string {
  const [field] = failure.fields ?? [];
  if (failure.code === "invalid_request" && field !== undefined) {
    const parts = field.split(".");
    const box = parts.at(-1) ?? field;
    const list = parts[0] ?? field;
    return errors[box] ?? errors[list] ?? errors.unknown ?? "";
  }
  return errors[failure.code] ?? errors.unknown ?? "";
}

/** Whether an invalid_request named this box: by its own name, or as a line of the list it is in ("items.2.label"). */
function names(field: string, box: string): boolean {
  const parts = field.split(".");
  return field === box || parts[0] === box || parts.at(-1) === box;
}

/**
 * The words for a box the API refused, for its Field's error, so the box is marked invalid and described by them;
 * null where the refusal named another box, or none.
 */
export function boxError(
  errors: Readonly<Record<string, string | undefined>>,
  failure: Failure | null,
  box: string,
): string | null {
  if (failure?.code !== "invalid_request") return null;
  const field = (failure.fields ?? []).find((each) => names(each, box));
  return field === undefined ? null : errorText(errors, { code: failure.code, fields: [field] });
}

/** The words for the form as a whole: any refusal but one that names a box among `boxes`, which their Fields say. */
export function formError(
  errors: Readonly<Record<string, string | undefined>>,
  failure: Failure | null,
  boxes: readonly string[],
): string | null {
  if (failure === null) return null;
  const shown = boxes.some((box) => boxError(errors, failure, box) !== null);
  return shown ? null : errorText(errors, failure);
}
