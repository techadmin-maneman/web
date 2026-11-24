// A lead ops take on a call (docs/decisions/0288-attribution-and-conversions.md): the caller's name and number, and
// the channel the call came from, which ops must pick, since a call carries nothing else, until a tracking number per
// channel says it instead. A new number is a person and a phone lead, answered on the call and never chased, as a
// WhatsApp lead is (docs/decisions/0138-strangers-in-the-inbox.md); a number one of our people has is a touch of theirs
// alone, their first touch left as it was. Both are audited.

import type { DeclaredChannel } from "../../policy/channels.ts";
import { personByMobile } from "../clients/people.ts";
import { auditStatement, type AuditActor } from "../platform/audit.ts";
import { withAttribution } from "./attribution.ts";
import { NOTHING_CARRIED, NO_CODES, numberClaimStatements, resolveCodes, touchStatement } from "./touches.ts";

export interface CallLead {
  readonly name: string;
  readonly mobileE164: string;
  readonly channel: DeclaredChannel;
  /** Where they are, as they said; a known number keeps the record it has. */
  readonly pincode?: string | undefined;
  readonly testRecord: boolean;
  readonly actor: AuditActor;
  readonly requestId: string;
  readonly now: Date;
}

/**
 * The call's touch, the channel ops picked on it, with the chats the number sent before we knew it, and the lead it
 * made pointed at it where it made one.
 */
async function callTouch(db: D1Database, call: CallLead, personId: string, leadId: string | null): Promise<void> {
  const { statement, recorded } = touchStatement(db, {
    at: call.now,
    via: "call",
    visitorId: null,
    personId,
    mobileE164: null,
    carried: NOTHING_CARRIED,
    resolved: await resolveCodes(db, NO_CODES),
    declared: { channel: call.channel, by: "ops" },
    adConsent: null,
    userAgent: null,
    clientIp: null,
  });
  const lead =
    leadId === null ? [] : [db.prepare("UPDATE leads SET touch_id = ?2 WHERE id = ?1").bind(leadId, recorded.id)];
  await withAttribution(db, personId, [statement, ...numberClaimStatements(db, personId), ...lead], call.now);
}

/** Takes the call: the person it is, and the lead made for a new number, which the CRM is to hear of; none for a known one. */
export async function leadFromCall(
  db: D1Database,
  call: CallLead,
): Promise<{ readonly personId: string; readonly leadId: string | null }> {
  const at = call.now.toISOString();
  const audited = (personId: string, known: boolean) =>
    auditStatement(
      db,
      {
        surface: "ops",
        actor: call.actor,
        action: "lead.call",
        subject: { kind: "person", id: personId },
        requestId: call.requestId,
        detail: { channel: call.channel, known },
      },
      call.now,
    );
  const known = await db
    .prepare("SELECT id FROM people WHERE mobile_e164 = ?1 AND erased_at IS NULL")
    .bind(call.mobileE164)
    .first<{ id: string }>();
  if (known !== null) {
    await callTouch(db, call, known.id, null);
    await audited(known.id, true).run();
    return { personId: known.id, leadId: null };
  }
  const personId = crypto.randomUUID();
  const leadId = crypto.randomUUID();
  await db.batch([
    personByMobile(db, {
      id: personId,
      mobile: call.mobileE164,
      name: call.name,
      testRecord: call.testRecord,
      contactable: "as_before",
      at,
      pincode: call.pincode,
    }),
    db
      .prepare("INSERT INTO leads (id, person_id, created_at, source, request_id) VALUES (?1, ?2, ?3, 'phone', ?4)")
      .bind(leadId, personId, at, call.requestId),
    db
      .prepare(
        "INSERT INTO events (id, created_at, name, subject_id, payload_json) VALUES (?1, ?2, 'lead_created', ?3, ?4)",
      )
      .bind(crypto.randomUUID(), at, leadId, JSON.stringify({ source: "phone", city: null })),
    audited(personId, false),
  ]);
  await callTouch(db, call, personId, leadId);
  return { personId, leadId };
}
