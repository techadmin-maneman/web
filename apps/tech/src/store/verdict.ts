// What a refusal means for the outbox's round, decided in one place for the writes and for the photographs a
// photograph set carries (./outbox.ts): wait for signal, sign in again, hold the step until it may land, stop the job
// because it changed under the phone, or stop it for the technician to put right.

import type { Moved } from "@maneman/web-kit/api";
import {
  ALREADY_CLOSED,
  OUT_OF_ORDER,
  SUPERSEDED,
  TOO_EARLY_TO_ARRIVE,
  TOO_EARLY_TO_CLOSE,
  unreachable,
  type Answer,
} from "../api.ts";

export type Refused = Extract<Answer<unknown>, { readonly ok: false }>;

export type Verdict =
  /** No signal, or none usable: everything still waiting stays waiting. */
  | { readonly kind: "retry_later" }
  | { readonly kind: "signed_out" }
  /** Before the earliest check-in, or before the no-show wait ran out. Nothing is wrong with the job. */
  | { readonly kind: "too_early"; readonly code: string }
  /** The job changed under the phone, has closed, or is no longer this technician's: the job stops there. */
  | {
      readonly kind: "superseded";
      readonly note: string;
      readonly fields: readonly string[];
      readonly moved: Moved | null;
    }
  /** The API would not take the write as it is: the job stops for the technician to put it right. */
  | { readonly kind: "refused"; readonly note: string; readonly fields: readonly string[]; readonly answer: Refused };

const STOPS_THE_JOB: readonly string[] = [SUPERSEDED, OUT_OF_ORDER, ALREADY_CLOSED];

export function classify(answer: Refused): Verdict {
  if (unreachable(answer)) return { kind: "retry_later" };
  if (answer.status === 401) return { kind: "signed_out" };
  if (answer.code === TOO_EARLY_TO_CLOSE || answer.code === TOO_EARLY_TO_ARRIVE) {
    return { kind: "too_early", code: answer.code };
  }
  if (STOPS_THE_JOB.includes(answer.code)) {
    return { kind: "superseded", note: answer.code, fields: answer.fields, moved: answer.moved };
  }
  if (answer.status === 404) return { kind: "superseded", note: "not_found", fields: [], moved: null };
  return { kind: "refused", note: answer.code, fields: answer.fields, answer };
}
