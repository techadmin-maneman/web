// Stopping our WhatsApp messages without signing in, as easily as agreeing to them: the signed link a reminder or
// the launch alert ends with withdraws the consent it was sent under, and a STOP reply withdraws both WhatsApp
// consents and is answered once. A withdrawal is written only while the purpose is given, with its audit entry in
// the same batch.

import type { Composed } from "./visit-messages.ts";
import { DAY_MS } from "../lib/durations.ts";
import { firstNameOf } from "../lib/names.ts";
import { signToken, verifyToken } from "../lib/signed-token.ts";
import { isMessagePurpose, MESSAGE_PURPOSES, type ConsentSource, type MessagePurpose } from "../policy/consents.ts";
import { auditStatementIfWritten } from "./audit.ts";
import { recordConsent } from "./consents.ts";
import { queueMessage } from "./queued-messages.ts";

/** How long a stop link works: a reminder may be read, and acted on, long after it came. */
const STOP_LINK_LIFETIME_MS = 365 * DAY_MS;

/** The notice a withdrawal is recorded under, as an erasure's is. */
const WITHDRAWAL_NOTICE = "withdrawal";

/** Whose consent a stop link withdraws, and which. */
interface StopLinkSubject {
  readonly personId: string;
  readonly purpose: MessagePurpose;
}

/** The link to the site's /stop page. The token goes in the fragment, which no server receives or logs. */
export async function stopLink(
  origin: string,
  signingKey: string,
  subject: StopLinkSubject,
  now: Date,
): Promise<string> {
  const expires = new Date(now.getTime() + STOP_LINK_LIFETIME_MS);
  const token = await signToken(signingKey, "stop_messages", `${subject.purpose} ${subject.personId}`, expires);
  return `${origin}/stop#${token}`;
}

/** The subject of a stop link's token, or null when it is forged, expired or names no purpose we message under. */
export async function readStopToken(signingKey: string, token: string, now: Date): Promise<StopLinkSubject | null> {
  const subject = await verifyToken(signingKey, "stop_messages", token, now);
  if (subject === null) return null;
  const [purpose, personId] = subject.split(" ");
  if (personId === undefined || !isMessagePurpose(purpose)) return null;
  return { personId, purpose };
}

interface Withdrawal {
  readonly personId: string;
  readonly purposes: readonly MessagePurpose[];
  readonly source: Extract<ConsentSource, "message_link" | "whatsapp_stop">;
  readonly ipHash: string | null;
  readonly requestId: string | null;
  readonly now: Date;
}

/** One purpose's withdrawal and its audit entry, each written only while the person still gives it. */
function withdrawalStatements(db: D1Database, withdrawal: Withdrawal, purpose: MessagePurpose) {
  const consent = recordConsent(db, {
    person: { id: withdrawal.personId },
    purpose,
    granted: false,
    notice: WITHDRAWAL_NOTICE,
    source: withdrawal.source,
    rule: "if_granted",
    ipHash: withdrawal.ipHash,
    givenAt: withdrawal.now.toISOString(),
  });
  const audit = auditStatementIfWritten(
    db,
    {
      surface: "public",
      actor: { kind: "client", id: withdrawal.personId },
      action: "consent.switch",
      requestId: withdrawal.requestId,
      detail: { purpose, granted: false, source: withdrawal.source },
    },
    withdrawal.now,
    { table: "consents", id: consent.id },
  );
  return { consent, audit };
}

/** Withdraws each purpose the person still gives. Returns the IDs of the rows written: none if nothing was given. */
export async function withdraw(db: D1Database, withdrawal: Withdrawal): Promise<string[]> {
  const writes = withdrawal.purposes.map((purpose) => withdrawalStatements(db, withdrawal, purpose));
  const results = await db.batch(writes.flatMap(({ consent, audit }) => [consent.statement, audit]));
  const written = writes.filter((_write, index) => {
    const consentResult = results[index * 2];
    return consentResult !== undefined && consentResult.results.length > 0;
  });
  return written.map(({ consent }) => consent.id);
}

/**
 * A STOP reply from a number: withdraws what its person still gives, and queues the one answer saying so. Returns
 * the answer's ID, or null for a number that is no one's, an erased person, or nothing left to withdraw.
 */
export async function stopByReply(
  db: D1Database,
  input: { mobileE164: string; requestId: string; now: Date },
): Promise<string | null> {
  const person = await db
    .prepare("SELECT id FROM people WHERE mobile_e164 = ?1 AND erased_at IS NULL")
    .bind(input.mobileE164)
    .first<{ id: string }>();
  if (person === null) return null;

  const withdrawn = await withdraw(db, {
    personId: person.id,
    purposes: MESSAGE_PURPOSES,
    source: "whatsapp_stop",
    ipHash: null,
    requestId: input.requestId,
    now: input.now,
  });
  const [firstWithdrawal] = withdrawn;
  if (firstWithdrawal === undefined) return null;

  const messageId = crypto.randomUUID();
  const at = input.now.toISOString();
  await queueMessage(db, {
    id: messageId,
    personId: person.id,
    kind: "messages_stopped",
    subject: { kind: "consent", id: firstWithdrawal },
    at,
  }).run();
  return messageId;
}

/** The answer to a STOP reply. It needs no consent: it answers the person's own message. */
export async function composeMessagesStopped(db: D1Database, personId: string): Promise<Composed> {
  const person = await db.prepare("SELECT name FROM people WHERE id = ?1").bind(personId).first<{ name: string }>();
  if (person === null) return { skip: "no such person" };
  return { template: "messages_stopped_v1", params: [firstNameOf(person.name)] };
}
