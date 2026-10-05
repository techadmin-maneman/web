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
