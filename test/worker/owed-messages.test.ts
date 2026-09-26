// The messages people are owed when something changes for them (docs/decisions/0073-hand-offs-and-messages.md):
// what each says, to whom, and when it is skipped. Each is sent by the messaging consumer, which writes the text
// as things stand when it sends. NOW is Monday 21 September 2026, 12 noon in India. Every name and number here is
// made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { renderMessage } from "../../src/config/message-templates.ts";
import { createLogger } from "../../src/log.ts";
import type { MessagingProvider } from "../../src/providers/messaging.ts";
import { sendMessage } from "../../src/queues/messaging.ts";
import { captureLogs, fakeDependencies, LOCAL_CONFIG, markDatabase, NOW } from "./helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const ENTRY = "22222222-2222-4222-8222-222222222222";

const log = createLogger();

function recordingProvider() {
  const sent: string[] = [];
  const provider: MessagingProvider = {
    send: ({ template, params }) => {
      sent.push(renderMessage(template, params) ?? `unknown template ${template}`);
      return Promise.resolve({ ok: true, providerMessageId: "wa-1" });
    },
    connection: () => Promise.resolve({ open: true }),
  };
  return { provider, sent };
}

async function consent(purpose: string, granted: boolean, personId = PERSON, at = NOW.toISOString()) {
  await env.DB.prepare(
    `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
     VALUES (?1, ?2, ?3, 'test-notice', ?4, ?5)`,
  )
    .bind(crypto.randomUUID(), personId, purpose, granted ? 1 : 0, at)
    .run();
}

async function queued(kind: string, subjectKind: string, subjectId: string, personId = PERSON): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_kind, subject_id, state, queued_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'queued', ?2)`,
  )
    .bind(id, NOW.toISOString(), personId, kind, subjectKind, subjectId)
    .run();
  return id;
}

/** Sends one queued message; what the client read, or why nothing went. */
async function send(messageId: string): Promise<{ text: string | null; skipped: string | null }> {
  const { provider, sent } = recordingProvider();
  await sendMessage(env.DB, LOCAL_CONFIG, fakeDependencies({ messaging: provider }), log, messageId);
  const row = await env.DB.prepare("SELECT state, last_error FROM outbound_messages WHERE id = ?1")
    .bind(messageId)
    .first<{ state: string; last_error: string | null }>();
  return { text: sent[0] ?? null, skipped: row?.state === "skipped" ? row.last_error : null };
}

beforeEach(async () => {
  await markDatabase();
  captureLogs();
  await env.DB.prepare(
    "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000001', 'Karan Bhatia')",
  )
    .bind(PERSON, NOW.toISOString())
    .run();
});

describe("the waitlist confirmation (REQ-03)", () => {
  async function listed(launchAlert: boolean) {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO serviceable_pincodes (pincode, area, city, served) VALUES ('400050', 'Bandra', 'Mumbai', 0)",
      ),
      env.DB.prepare(
        `INSERT INTO waitlist_entries (id, pincode, person_id, contact_consent_at, launch_alert, created_at)
         VALUES (?1, '400050', ?2, ?3, ?4, ?3)`,
      ).bind(ENTRY, PERSON, NOW.toISOString(), launchAlert ? 1 : 0),
    ]);
    await consent("contact", true);
    if (launchAlert) await consent("whatsapp_launches", true);
    return queued("waitlist_confirmation", "waitlist_entry", ENTRY);
  }

  it("names the area, and promises word of the launch to one who asked for it", async () => {
    const sent = await send(await listed(true));
    expect(sent.text).toBe(
      "Hello Karan, you are on our list for Bandra. We will message you on WhatsApp when we come there.",
    );
  });

  it("promises nothing more to one who did not ask to be told of the launch", async () => {
    const sent = await send(await listed(false));
    expect(sent.text).toBe("Hello Karan, you are on our list for Bandra. We do not come there yet.");
  });

  it("promises nothing more once the launch alert was switched off", async () => {
    const message = await listed(true);
    await consent("whatsapp_launches", false, PERSON, "2026-09-21T06:31:00.000Z");
    expect((await send(message)).text).toBe("Hello Karan, you are on our list for Bandra. We do not come there yet.");
  });

  it("is not sent once the consent to be contacted about the request was withdrawn", async () => {
    const message = await listed(false);
    await consent("contact", false, PERSON, "2026-09-21T06:31:00.000Z");
    expect(await send(message)).toEqual({ text: null, skipped: "no consent to be contacted about the request" });
  });

  it("is not sent once the entry is gone", async () => {
    const message = await listed(false);
    await env.DB.prepare("DELETE FROM waitlist_entries").run();
    expect(await send(message)).toEqual({ text: null, skipped: "no longer on the waitlist" });
  });
});
