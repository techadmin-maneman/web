// A WhatsApp message sent in the words the Words page set (src/queues/messaging.ts, src/domain/words/words.ts,
// src/providers/messaging/; docs/decisions/0128-messages-with-the-words-set.md): the bridge sends them at once, the
// code's wording until any are set. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { renderWithStopLink, TEMPLATES } from "../../../src/config/message-templates.ts";
import { createLogger } from "../../../src/log.ts";
import type { MessagingProvider, OutboundMessage } from "../../../src/providers/messaging/index.ts";
import { sendMessage } from "../../../src/queues/messaging.ts";
import { LOCAL_CONFIG, NOW, appFor, captureLogs, fakeDependencies, markDatabase, request } from "../helpers.ts";
import { insertPerson } from "../tryon-fixtures.ts";

const PERSON = "55555555-5555-4555-8555-555555555552";

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  await insertPerson(PERSON, "+919810000052", "Karan Bhatia");
  await env.DB.prepare(
    `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at, source)
     VALUES (?1, ?2, 'whatsapp_launches', 'v1', 1, '2026-09-01T00:00:00Z', 'site_waitlist')`,
  )
    .bind(crypto.randomUUID(), PERSON)
    .run();
  await env.DB.prepare(
    "INSERT INTO serviceable_pincodes (pincode, area, city, served) VALUES ('122018', 'Sector 65', 'Gurgaon', 1)",
  ).run();
});

/** The launch alert to the person, sent through a provider that records what it was asked to send. */
async function sentAlert(): Promise<OutboundMessage | undefined> {
  const sent: OutboundMessage[] = [];
  const provider: MessagingProvider = {
    send: (message) => {
      sent.push(message);
      return Promise.resolve({ ok: true, providerMessageId: "wa-1" });
    },
    connection: () => Promise.resolve({ open: true }),
  };
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_id, state, queued_at)
     VALUES (?1, ?2, ?3, 'launch_alert', '122018', 'queued', ?2)`,
  )
    .bind(id, NOW.toISOString(), PERSON)
    .run();
  await sendMessage({
    db: env.DB,
    config: LOCAL_CONFIG,
    deps: fakeDependencies({ messaging: provider }),
    log: createLogger(),
    messageId: id,
  });
  return sent[0];
}

const setWords = (key: string, text: string) =>
  request(appFor("local", fakeDependencies(), {}, "ops"), "/api/words", {
    method: "POST",
    headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
    body: JSON.stringify({ key, text }),
  });

describe("a message's words", () => {
  it("are the code's until the Words page sets any", async () => {
    const sent = await sentAlert();
    expect(sent?.template).toBe("launch_alert_v1");
    expect(sent?.wording).toBeUndefined();
  });

  it("are the ones the Words page set, for the text and its stop line, which the bridge sends", async () => {
    const alert = "Hi {{1}}, we now come to {{2}}. Book a free consultation: {{3}}";
    expect(alert).not.toBe(TEMPLATES.launch_alert_v1);
    expect((await setWords("message:launch_alert_v1", alert)).status).toBe(200);
    expect((await setWords("message:stop_link_v1", "To stop these: {{1}}")).status).toBe(200);

    const sent = await sentAlert();
    expect(sent?.wording).toEqual({ text: alert, stop: "To stop these: {{1}}" });
    const text = renderWithStopLink("launch_alert_v1", sent?.params ?? [], sent?.stopLink, sent?.wording);
    expect(text).toContain("Hi Karan, we now come to Gurgaon.");
    expect(text).toMatch(/\n\nTo stop these: http/);
  });
});
