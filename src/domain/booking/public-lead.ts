// The name and number /book asks for first, kept as a lead before the visit is chosen
// (docs/decisions/0116-book-asks-for-the-name-and-number-first.md). Someone who stops before the slot or the address
// has left what ops need to call them, and the CRM has them as a lead with no date yet.
//
// Every number gets the same answer, so the form tells nobody whether a number is a client's. Nothing is written for
// someone who has had a visit, or booked or asked for one: they are followed up already. Nor is a second lead for
// someone who left one in the last day. The booking that follows leaves its own lead, which the CRM adds to the same
// record (src/queues/crm-sync.ts).

import { CONSULTATION_NOTICES } from "../../config/notices.ts";
import { DAY_MS } from "../../lib/durations.ts";
import { testRecordAtCreation } from "../../policy/staging-test-records.ts";
import type { LeadAttribution } from "../leads/leads.ts";
import { hasAskedForAVisit } from "../referrals/referrals.ts";
import { formPerson, personWithMobile } from "./form-person.ts";
import { type FormRefusalCode, type FormRequest, type Refusal, recordLead } from "./public-booking.ts";

interface LeadRequest {
  readonly name: string;
  readonly mobile: string;
  readonly turnstileToken: string;
  readonly attribution: LeadAttribution;
}

/** Whether the person left their name and number here in the last day. */
async function leftOneToday(db: D1Database, personId: string, now: Date): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 FROM leads
       WHERE person_id = ?1 AND source = 'form' AND proposed_visit_date IS NULL AND first_choice_window IS NULL
         AND created_at > ?2 LIMIT 1`,
    )
    .bind(personId, new Date(now.getTime() - DAY_MS).toISOString())
    .first();
  return row !== null;
}

/** Whether a lead is owed for this number: not for a client, nor twice in a day. */
async function leadOwed(db: D1Database, knownId: string | null, now: Date): Promise<boolean> {
  if (knownId === null) return true;
  const [asked, left] = await Promise.all([hasAskedForAVisit(db, knownId), leftOneToday(db, knownId, now)]);
  return !asked && !left;
}

/** Keeps the name and number, with the agreement the step showed, as a lead. */
export async function leaveNameAndNumber(
  form: FormRequest,
  request: LeadRequest,
): Promise<{ readonly ok: true } | Refusal<FormRefusalCode>> {
  const checked = await form.checkPerson(request.mobile, request.turnstileToken, request.name);
  if (!checked.ok) return checked;
  const { db, now } = form;
  const knownId = await personWithMobile(db, checked.mobile);
  if (!(await leadOwed(db, knownId, now))) return { ok: true };

  const person = formPerson(db, {
    knownId,
    mobile: checked.mobile,
    name: request.name,
    testRecord: testRecordAtCreation(form.environment, request.name),
    purpose: "whatsapp_visits",
    notice: CONSULTATION_NOTICES.site_booking,
    source: "site_booking",
    ipHash: checked.ipHash,
    now,
  });
  await db.batch(person.statements);
  await recordLead(form, {
    personId: person.id,
    name: request.name,
    mobile: checked.mobile,
    pincode: null,
    lossExtent: null,
    date: null,
    attribution: request.attribution,
    served: true,
    now,
  });
  return { ok: true };
}
