// The discount code a site booking was given (docs/decisions/0108-discount-codes.md): typed on /book, or a partner's
// own, which its invite carries, checked as only a consultation and fit in one visit takes one.

import { checkForOneVisit, type OneVisitCode } from "../money/discount-code-holds.ts";
import { isPartnerInvite, type AnyInvite } from "../referrals/channels.ts";
import type { FormRequest, Refusal } from "./public-booking.ts";

/** What a booking asked for of a code: the one typed, and the invite it came with. */
interface AskedFor {
  readonly discountCode: string | null;
  readonly invite: AnyInvite | null;
}

/** The code asked for: typed on /book, else a partner's own, which its invite carries; null for none. */
function askedCode(request: AskedFor): { readonly text: string; readonly fromInvite: boolean } | null {
  if (request.discountCode !== null) return { text: request.discountCode, fromInvite: false };
  const { invite } = request;
  if (invite === null || !isPartnerInvite(invite) || invite.discount === null) return null;
  return { text: invite.discount.code, fromInvite: true };
}

/**
 * The code given, checked: only a consultation and fit in one visit takes one, a consultation costing nothing. One
 * typed that does not apply refuses the booking, so the client can take it out or put it right; the form says only
 * that it does not apply, and the reason is logged. A partner's own code is the invite's offer, never typed: where it
 * does not apply, the booking goes ahead without it (docs/decisions/0125-partner-discount-codes.md).
 */
export async function oneVisitCode(
  form: FormRequest,
  request: AskedFor,
  knownId: string | null,
  oneVisit: boolean,
): Promise<OneVisitCode | Refusal | null> {
  const asked = askedCode(request);
  if (asked === null) return null;
  const notApplicable = asked.fromInvite
    ? null
    : ({ ok: false, code: "code_not_applicable", fields: ["discount_code"] } as const);
  if (!oneVisit) {
    if (!asked.fromInvite) form.log.info("discount_code_refused", { reason: "not_covered" });
    return notApplicable;
  }
  const checked = await checkForOneVisit({ db: form.db, text: asked.text, personId: knownId, now: form.now });
  if (checked.ok) return checked;
  form.log.info("discount_code_refused", { reason: checked.reason, from_invite: asked.fromInvite });
  return notApplicable;
}
