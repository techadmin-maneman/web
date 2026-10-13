// A chat from a number we don't know (docs/decisions/0138-strangers-in-the-inbox.md): Customer Care link it to the
// client it turns out to be, writing from another phone, or save the person as someone new by the name they gave.
// Either way the chat is theirs from then on, with a Care person. Each is audited. Someone saved is a WhatsApp lead,
// which the CRM hears of as any lead, marked to be answered in the chat and never chased: they only wrote to us.

import { personByMobile } from "../clients/people.ts";
import { auditStatement, type AuditActor } from "../platform/audit.ts";
import type { ChannelCode } from "../../policy/channels.ts";
import { giveCarePerson } from "./care-people.ts";

interface Change {
  readonly conversationId: string;
  readonly actor: AuditActor;
  readonly requestId: string;
  readonly now: Date;
}

/** The chat as a stranger's: its number, or why it is not one. */
async function strangerChat(db: D1Database, id: string): Promise<{ mobile: string } | "not_found" | "known"> {
  const chat = await db
    .prepare("SELECT mobile_e164, person_id FROM conversations WHERE id = ?1")
    .bind(id)
    .first<{ mobile_e164: string; person_id: string | null }>();
  if (chat === null || chat.mobile_e164.startsWith("erased:")) return "not_found";
  return chat.person_id === null ? { mobile: chat.mobile_e164 } : "known";
}

const audited = (db: D1Database, change: Change, action: "chat.link" | "chat.save", personId: string) =>
  auditStatement(
    db,
    {
      surface: "ops",
      actor: change.actor,
      action,
      subject: { kind: "conversation", id: change.conversationId },
      requestId: change.requestId,
      detail: { person: personId },
    },
    change.now,
  );

/** Links a stranger's chat to a client, as Care find it to be theirs. */
export async function linkChat(
  db: D1Database,
  change: Change & { readonly personId: string },
): Promise<"linked" | "not_found" | "known" | "no_client"> {
  const chat = await strangerChat(db, change.conversationId);
  if (typeof chat === "string") return chat;
  const client = await db
    .prepare("SELECT 1 FROM people WHERE id = ?1 AND erased_at IS NULL")
    .bind(change.personId)
    .first();
  if (client === null) return "no_client";
  await db.batch([
    db
      .prepare("UPDATE conversations SET person_id = ?2, updated_at = ?3 WHERE id = ?1 AND person_id IS NULL")
      .bind(change.conversationId, change.personId, change.now.toISOString()),
    audited(db, change, "chat.link", change.personId),
  ]);
  await giveCarePerson(db, change.personId, change.now);
  return "linked";
}

/**
 * Saves a stranger as someone new: a person by the chat's number and the name they gave, their WhatsApp lead with how
 * they told Care they found us, and the chat theirs. A number one of our people already has is linked instead, never saved twice.
 */
export async function saveStranger(
  db: D1Database,
  change: Change & { readonly name: string; readonly testRecord: boolean; readonly foundUs: ChannelCode | null },
): Promise<{ readonly personId: string; readonly leadId: string } | "not_found" | "known" | "has_number"> {
  const chat = await strangerChat(db, change.conversationId);
  if (typeof chat === "string") return chat;
  const holder = await db.prepare("SELECT id FROM people WHERE mobile_e164 = ?1").bind(chat.mobile).first();
  if (holder !== null) return "has_number";
  const personId = crypto.randomUUID();
  const leadId = crypto.randomUUID();
  const at = change.now.toISOString();
  await db.batch([
    personByMobile(db, {
      id: personId,
      mobile: chat.mobile,
      name: change.name,
      testRecord: change.testRecord,
      contactable: "as_before",
      at,
    }),
    db
      .prepare(
        "INSERT INTO leads (id, person_id, created_at, source, request_id, found_us) VALUES (?1, ?2, ?3, 'whatsapp', ?4, ?5)",
      )
      .bind(leadId, personId, at, change.requestId, change.foundUs),
    db
      .prepare(
        "INSERT INTO events (id, created_at, name, subject_id, payload_json) VALUES (?1, ?2, 'lead_created', ?3, ?4)",
      )
      .bind(crypto.randomUUID(), at, leadId, JSON.stringify({ source: "whatsapp", city: null })),
    db
      .prepare("UPDATE conversations SET person_id = ?2, updated_at = ?3 WHERE id = ?1 AND person_id IS NULL")
      .bind(change.conversationId, personId, at),
    audited(db, change, "chat.save", personId),
  ]);
  await giveCarePerson(db, personId, change.now);
  return { personId, leadId };
}
