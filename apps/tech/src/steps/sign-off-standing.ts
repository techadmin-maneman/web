// Where a fit's sign-off stands on this phone (docs/decisions/0254-client-signs-off-the-fit.md): the card's word, or the
// latest sign-off write the phone still holds to send, as ./SignOff.tsx draws it.

import type { Job } from "../api.ts";
import type { Queued } from "../store/outbox.ts";

export type Standing = "unasked" | "asked" | "flagged" | "signed" | "declined";

const SIGN_OFF_KINDS: readonly string[] = ["sign_off_request", "sign_off_declined"];

/** The sign-off's latest write this phone still holds to send; none where everything has gone. */
export const heldOf = (job: Job, queued: readonly Queued[]): Queued | undefined =>
  queued.findLast(
    (event) => event.job_id === job.id && event.state === "waiting" && SIGN_OFF_KINDS.includes(event.kind),
  );

/** Signed or declined on the card is final; otherwise the latest write the phone holds says where it stands. */
export function standingOf(job: Job, held: Queued | undefined): Standing {
  const state = job.sign_off?.state;
  if (state === "signed" || state === "declined" || held === undefined) return state ?? "unasked";
  return held.kind === "sign_off_declined" ? "declined" : "asked";
}

/** Why the client did not sign: the card's, once it has it, else the decline the phone still holds. */
export function declinedWhy(job: Job, held: Queued | undefined): string {
  if (job.sign_off?.state === "declined") return job.sign_off.declined_reason ?? "";
  return (held?.body as { readonly reason?: string } | null | undefined)?.reason ?? "";
}
