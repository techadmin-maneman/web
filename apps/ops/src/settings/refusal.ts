// A refusal from the API, said in the console's words (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).
// An invalid_request names the boxes it refused (`fields`): "unit_cost", or a line of a list, "items.2.label". The
// words are looked up by the box's own name, then by the list's, then by the code, then the catch-all.

export interface Failure {
  readonly code: string;
  readonly fields: readonly string[];
}

export function refusalOf(errors: Readonly<Record<string, string>>, failure: Failure): string {
  const [field] = failure.fields;
  if (failure.code === "invalid_request" && field !== undefined) {
    const parts = field.split(".");
    const box = parts.at(-1) ?? field;
    const list = parts[0] ?? field;
    return errors[box] ?? errors[list] ?? errors.unknown ?? "";
  }
  return errors[failure.code] ?? errors.unknown ?? "";
}
