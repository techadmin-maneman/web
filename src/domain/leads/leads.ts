// Writing a booking or waitlist lead. The person, the lead and an event go in
// one D1 batch, which D1 applies as a single transaction: all of it lands, or
// none of it does. The consent was recorded before this, under the notice the
// page showed (src/domain/booking/public-booking.ts). The CRM hears about the lead
// afterwards, from the crm-sync queue.

import type { LossExtent } from "../../config/booking.ts";
import { personByMobile } from "../clients/people.ts";

export interface LeadAttribution {
  readonly utm_source?: string | undefined;
  readonly utm_medium?: string | undefined;
  readonly utm_campaign?: string | undefined;
  readonly utm_content?: string | undefined;
  readonly gclid?: string | undefined;
  readonly fbclid?: string | undefined;
  readonly referrer?: string | undefined;
  readonly landing_path?: string | undefined;
}

interface BookingLead {
  readonly leadId: string;
  /** Used only if the mobile number is new to us. */
  readonly newPersonId: string;
  readonly name: string;
  /** Whether a person this makes is a test record (testRecordAtCreation, src/policy/staging-test-records.ts). */
  readonly testRecord: boolean;
  readonly mobileE164: string;
  /** Null where the pincode's city is not one of ours (migration 0025). */
  readonly city: string | null;
  /** "form" for a served pincode or city, "waitlist" otherwise. */
  readonly source: "form" | "waitlist";
  /** The public form asks; an invited friend is never asked. */
  readonly lossExtent: LossExtent | null;
  readonly proposedVisitDate: string | null;
  readonly attribution: LeadAttribution;
  readonly requestId: string;
  readonly now: Date;
}

export async function saveBookingLead(db: D1Database, lead: BookingLead): Promise<void> {
  const at = lead.now.toISOString();
  const personId = "(SELECT id FROM people WHERE mobile_e164 = ?)";
  const attribution = lead.attribution;

  await db.batch([
    // A returning person keeps their ID and their name, and becomes contactable.
    personByMobile(db, {
      id: lead.newPersonId,
      mobile: lead.mobileE164,
      name: lead.name,
      testRecord: lead.testRecord,
      contactable: "becomes",
      at,
    }),

    db
      .prepare(
        `INSERT INTO leads (id, person_id, created_at, source, city, loss_extent, proposed_visit_date,
           utm_source, utm_medium, utm_campaign, utm_content, gclid, fbclid, referrer, landing_path, request_id)
         VALUES (?, ${personId}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        lead.leadId,
        lead.mobileE164,
        at,
        lead.source,
        lead.city,
        lead.lossExtent,
        lead.proposedVisitDate,
        attribution.utm_source ?? null,
        attribution.utm_medium ?? null,
        attribution.utm_campaign ?? null,
        attribution.utm_content ?? null,
        attribution.gclid ?? null,
        attribution.fbclid ?? null,
        attribution.referrer ?? null,
        attribution.landing_path ?? null,
        lead.requestId,
      ),

    db
      .prepare(
        "INSERT INTO events (id, created_at, name, subject_id, payload_json) VALUES (?, ?, 'lead_created', ?, ?)",
      )
      .bind(crypto.randomUUID(), at, lead.leadId, JSON.stringify({ source: lead.source, city: lead.city })),
  ]);
}
