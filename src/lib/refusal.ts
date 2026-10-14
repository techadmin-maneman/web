// What a domain function answers when it refuses: a code its route answers with as it stands (src/http/errors.ts,
// ERROR_STATUS), so a route maps nothing of its own and a refusal carries one status on every surface. Each module
// names the codes it may refuse with in its own answer type.

export interface Refusal<Code extends string> {
  readonly ok: false;
  readonly code: Code;
  /** For invalid_request: the fields refused, where the request was well formed and did not add up. */
  readonly fields?: readonly string[];
}

export const refusal = <Code extends string>(code: Code, fields?: readonly string[]): Refusal<Code> =>
  fields === undefined ? { ok: false, code } : { ok: false, code, fields };
