// Writing a booking or waitlist lead. Everything for one submission (the
// person, their consent, the lead and an event) goes in one D1 batch, which
// D1 applies as a single transaction: all of it lands, or none of it does.
// The CRM hears about it afterwards, from the crm-sync queue.

import type { LossExtent, VisitWindow } from "../config/booking.ts";
import { CURRENT_NOTICE } from "../config/notices.ts";

export interface Attribution {
  readonly utm_source?: string | undefined;
  readonly utm_medium?: string | undefined;
  readonly utm_campaign?: string | undefined;
  readonly utm_content?: string | undefined;
  readonly gclid?: string | undefined;
  readonly fbclid?: string | undefined;
  readonly referrer?: string | undefined;
  readonly landing_path?: string | undefined;
}

export interface BookingLead {
  readonly leadId: string;
  /** Used only if the mobile number is new to us. */
  readonly newPersonId: string;
  readonly name: string;
  readonly mobileE164: string;
  readonly city: string;
  /** "form" for a served city, "waitlist" otherwise. */
  readonly source: "form" | "waitlist";
  readonly window: VisitWindow;
  readonly lossExtent: LossExtent;
  readonly proposedVisitDate: string | null;
  readonly attribution: Attribution;
  readonly ipHash: string;
  readonly requestId: string;
  readonly now: Date;
}

export async function saveBookingLead(db: D1Database, lead: BookingLead): Promise<void> {
  const at = lead.now.toISOString();
  const personId = "(SELECT id FROM people WHERE mobile_e164 = ?)";
  const attribution = lead.attribution;

  await db.batch([
    // A returning person keeps their ID; their name is updated and they become contactable.
    db
      .prepare(
        `INSERT INTO people (id, created_at, mobile_e164, name, contactable) VALUES (?, ?, ?, ?, 1)
         ON CONFLICT (mobile_e164) DO UPDATE SET name = excluded.name, contactable = 1`,
      )
      .bind(lead.newPersonId, at, lead.mobileE164, lead.name),

    db
      .prepare(
        `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at, ip_hash)
         VALUES (?, ${personId}, 'contact', ?, 1, ?, ?)`,
      )
      .bind(crypto.randomUUID(), lead.mobileE164, CURRENT_NOTICE.contact, at, lead.ipHash),

    db
      .prepare(
        `INSERT INTO leads (id, person_id, created_at, source, city, first_choice_window, loss_extent,
           proposed_visit_date, utm_source, utm_medium, utm_campaign, utm_content, gclid, fbclid,
           referrer, landing_path, request_id)
         VALUES (?, ${personId}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        lead.leadId,
        lead.mobileE164,
        at,
        lead.source,
        lead.city,
        lead.window,
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

export async function loadBlackouts(db: D1Database, from: string, to: string): Promise<Set<string>> {
  const { results } = await db
    .prepare("SELECT date FROM visit_blackouts WHERE date BETWEEN ?1 AND ?2")
    .bind(from, to)
    .all<{ date: string }>();
  return new Set(results.map((row) => row.date));
}
