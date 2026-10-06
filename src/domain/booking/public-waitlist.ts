// Joining the waitlist where we do not come yet, from the site's form or an invite's landing (./public-booking.ts):
// the lead and the entry, with no slot and no address.

import type { LossExtent } from "../../config/booking.ts";
import { type ToldNotice, LANDING_NOTICES, CURRENT_NOTICE } from "../../config/notices.ts";
import type { ConsentSource } from "../../policy/consents.ts";
import { testRecordAtCreation } from "../../policy/staging-test-records.ts";
import { pincodeOf } from "../clients/service-area.ts";
import type { LeadAttribution } from "../leads/leads.ts";
import { type ConsentRule, recordConsent } from "../privacy/consents.ts";
import { type Invite, type InviteState, hasAskedForAVisit } from "../referrals/referrals.ts";
import { personWithMobile, formPerson } from "./form-person.ts";
import {
  type FormRequest,
  type Refusal,
  queueMessage,
  applyInvite,
  recordLead,
  inviteAsForANewNumber,
} from "./public-booking.ts";
import { waitlistConfirmation } from "./waitlist.ts";

export interface WaitlistRequest {
  readonly name: string;
  readonly mobile: string;
  readonly pincode: string;
  readonly lossExtent: LossExtent | null;
  readonly launchAlert: boolean;
  readonly turnstileToken: string;
  readonly attribution: LeadAttribution;
  readonly invite: Invite | null;
  /** The line beside the invite that told the friend their referrer hears of the fit; null where the page showed none. */
  readonly toldNotice: ToldNotice | null;
  /**
   * Where the consents on the form are given: the site's waitlist, or an invite's page
   * (docs/decisions/0094-where-a-consent-was-given.md).
   */
  readonly source: Extract<ConsentSource, "site_waitlist" | "referral_landing">;
}

interface Listed {
  readonly ok: true;
  /** Null until ops have named the area, and for a pincode we do not know. */
  readonly area: string | null;
  readonly credits: boolean;
  readonly invite: InviteState;
}

/**
 * The invite a waitlist entry carries: none for someone who has had a visit, or booked or asked for one. Anyone can
 * join a list with a number, so the list never attributes a client already in the funnel; ops may attach their invite
 * on the client's page instead.
 */
async function waitlistInvite(db: D1Database, knownId: string | null, invite: Invite | null): Promise<Invite | null> {
  if (invite === null || knownId === null) return invite;
  if (await hasAskedForAVisit(db, knownId)) return null;
  return invite;
}

/**
 * How the launch alert ticked on the form is recorded: as given, for someone new; for someone we know, only while
 * they have never decided it. Anyone can fill in the form with their number, so a decision they made stands.
 */
function launchAlertRule(knownId: string | null): ConsentRule {
  return knownId === null ? "always" : "if_undecided";
}

/**
 * Takes the number for a pincode we do not serve yet, with the launch alert if it was asked for. A number we know is
 * answered as a new number is, whatever its invite came to.
 */
export async function joinTheWaitlist(
  form: FormRequest,
  request: WaitlistRequest,
): Promise<Listed | Refusal<400 | 403 | 422 | 429 | 503>> {
  const { db, now } = form;
  const pincode = await pincodeOf(db, request.pincode);
  if (pincode?.served === 1) return { ok: false, status: 422, code: "not_bookable" };
  const checked = await form.checkPerson(request.mobile, request.turnstileToken, request.name);
  if (!checked.ok) return checked;

  const knownId = await personWithMobile(db, checked.mobile);
  const invite = await waitlistInvite(db, knownId, request.invite);
  const person = formPerson(db, {
    knownId,
    mobile: checked.mobile,
    name: request.name,
    testRecord: testRecordAtCreation(form.environment, request.name),
    purpose: "contact",
    notice: LANDING_NOTICES.waitlist,
    source: request.source,
    ipHash: checked.ipHash,
    now,
  });
  const personId = person.id;
  const at = now.toISOString();
  const launchAlert = request.launchAlert
    ? [
        recordConsent(db, {
          person: { id: personId },
          purpose: "whatsapp_launches",
          granted: true,
          notice: CURRENT_NOTICE.whatsapp_launches,
          source: request.source,
          rule: launchAlertRule(knownId),
          ipHash: checked.ipHash,
          givenAt: at,
        }).statement,
      ]
    : [];
  const written = await db.batch<{ id: string }>([
    ...person.statements,
    ...launchAlert,
    db
      .prepare(
        `INSERT INTO waitlist_entries (id, pincode, person_id, referral_code, contact_consent_at, launch_alert,
           created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?5)
         ON CONFLICT (pincode, person_id) DO UPDATE SET launch_alert = MAX(launch_alert, excluded.launch_alert)`,
      )
      .bind(crypto.randomUUID(), request.pincode, personId, invite?.code ?? null, at, request.launchAlert ? 1 : 0),
    waitlistConfirmation(db, { personId, pincode: request.pincode, now }),
  ]);
  const confirmation = written.at(-1)?.results[0]?.id;
  if (confirmation !== undefined) await queueMessage(form, confirmation);
  const invited = await applyInvite(db, {
    invite,
    personId,
    via: "waitlist",
    pincode: request.pincode,
    toldNotice: request.toldNotice,
    now,
  });

  await recordLead(form, {
    personId,
    name: request.name,
    mobile: checked.mobile,
    pincode,
    lossExtent: request.lossExtent,
    date: null,
    attribution: request.attribution,
    served: false,
    now,
  });
  const told = knownId === null ? invited : inviteAsForANewNumber(request.invite, pincode?.launched_at ?? null, now);
  return { ok: true, area: pincode?.area ?? null, ...told };
}
