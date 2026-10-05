// Stopping our WhatsApp messages as easily as agreeing to them: the link at the foot of a reminder or the
// launch alert, which withdraws its consent from the site's /stop page without signing in; the launch alert, which
// reads the consent again when it is sent; and the answer to a STOP reply.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { signToken } from "../../../src/lib/signed-token.ts";
import { createLogger } from "../../../src/log.ts";
import { stopLink } from "../../../src/domain/stop-messages.ts";
import type { MessagingProvider, OutboundMessage } from "../../../src/providers/messaging/index.ts";
import { sendMessage } from "../../../src/queues/messaging.ts";
import {
  LOCAL_CONFIG,
  LOCAL_SETTINGS,
  NOW,
  appFor,
  captureLogs,
  fakeDependencies,
  markDatabase,
  request,
} from "../helpers.ts";
import { insertPerson } from "../tryon-fixtures.ts";

const PERSON = "55555555-5555-4555-8555-555555555551";
const MOBILE = "+919810000051";
const SIGNING_KEY = LOCAL_SETTINGS.tryon.linkSigningKey;
const DAY_MS = 86_400_000;

let logs: ReturnType<typeof captureLogs>;

beforeEach(async () => {
  logs = captureLogs();
  await markDatabase();
  await insertPerson(PERSON, MOBILE, "Karan Bhatia");
  for (const purpose of ["whatsapp_visits", "whatsapp_launches"]) {
    await env.DB.prepare(
      `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at, source)
       VALUES (?1, ?2, ?3, 'v1', 1, '2026-09-01T00:00:00Z', 'site_waitlist')`,
    )
      .bind(crypto.randomUUID(), PERSON, purpose)
      .run();
  }
});

/** The token in a stop link, from its fragment. */
async function tokenFor(purpose: "whatsapp_visits" | "whatsapp_launches"): Promise<string> {
  const link = await stopLink("https://maneman.test", SIGNING_KEY, { personId: PERSON, purpose }, NOW);
  return new URL(link).hash.slice(1);
}

function stop(token: string, at: Date = NOW) {
  return request(appFor("local", fakeDependencies({ now: () => at })), "/api/stop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
}

async function latest(purpose: string) {
  return env.DB.prepare(
    `SELECT granted, source, notice_version FROM consents WHERE person_id = ?1 AND purpose = ?2
     ORDER BY created_at DESC, rowid DESC LIMIT 1`,
  )
    .bind(PERSON, purpose)
    .first();
}

const count = async (table: "consents" | "audit_log") =>
  env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<number>("n");

describe("POST /api/stop", () => {
  it("withdraws the consent the link names, and only that one, with its audit entry", async () => {
    const res = await stop(await tokenFor("whatsapp_visits"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ purpose: "whatsapp_visits" });
    expect(await latest("whatsapp_visits")).toEqual({
      granted: 0,
      source: "message_link",
      notice_version: "withdrawal",
    });
    expect(await latest("whatsapp_launches")).toMatchObject({ granted: 1 });
    const audit = await env.DB.prepare("SELECT surface, actor, action, detail FROM audit_log").all();
    expect(audit.results).toEqual([
      {
        surface: "public",
        actor: PERSON,
        action: "consent.switch",
        detail: JSON.stringify({ purpose: "whatsapp_visits", granted: false, source: "message_link" }),
      },
    ]);
  });

  it("answers the same to a second tap, and records the withdrawal once", async () => {
    const token = await tokenFor("whatsapp_launches");
    await stop(token);
    const before = { consents: await count("consents"), audit: await count("audit_log") };

    const again = await stop(token);

    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ purpose: "whatsapp_launches" });
    expect({ consents: await count("consents"), audit: await count("audit_log") }).toEqual(before);
  });

  it("works for a year after the message was sent, and not after", async () => {
    const token = await tokenFor("whatsapp_visits");
    expect((await stop(token, new Date(NOW.getTime() + 366 * DAY_MS))).status).toBe(404);
    expect((await stop(token, new Date(NOW.getTime() + 364 * DAY_MS))).status).toBe(200);
  });

  it("refuses a forged token, one made for another use, and one naming a consent we do not message under", async () => {
    const token = await tokenFor("whatsapp_visits");
    const expires = new Date(NOW.getTime() + DAY_MS);
    const refused = [
      `${token.slice(0, -2)}xx`,
      await signToken(SIGNING_KEY, "result", `whatsapp_visits ${PERSON}`, expires),
      await signToken(SIGNING_KEY, "stop_messages", `photos_marketing ${PERSON}`, expires),
      await signToken(
        "another-key-of-at-least-thirty-two-chars",
        "stop_messages",
        `whatsapp_visits ${PERSON}`,
        expires,
      ),
    ];
    for (const each of refused) expect((await stop(each)).status).toBe(404);
    expect(await latest("whatsapp_visits")).toMatchObject({ granted: 1 });
    expect(await count("audit_log")).toBe(0);
  });

  it("never logs the token", async () => {
    const token = await tokenFor("whatsapp_visits");
    await stop(token);
    const logged = JSON.stringify(logs.lines());
    expect(logged).toContain("messages_stopped");
    expect(logged).not.toContain(token);
  });

  it("answers only on the public host", async () => {
    const token = await tokenFor("whatsapp_visits");
    for (const surface of ["client", "ops", "tech"] as const) {
      const res = await request(appFor("local", fakeDependencies(), {}, surface), "/api/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
        body: JSON.stringify({ token }),
      });
      expect(res.status, surface).toBe(404);
    }
  });
});

/** A messaging provider that records each message it was asked to send. */
function recordingProvider() {
  const sent: OutboundMessage[] = [];
  const provider: MessagingProvider = {
    send: (message) => {
      sent.push(message);
      return Promise.resolve({ ok: true, providerMessageId: "wa-1" });
    },
    connection: () => Promise.resolve({ open: true }),
  };
  return { provider, sent };
}

async function queued(kind: string, subjectId: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_id, state, queued_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 'queued', ?2)`,
  )
    .bind(id, NOW.toISOString(), PERSON, kind, subjectId)
    .run();
  return id;
}

async function send(messageId: string, provider: MessagingProvider) {
  await sendMessage(env.DB, LOCAL_CONFIG, fakeDependencies({ messaging: provider }), createLogger(), messageId);
  return env.DB.prepare("SELECT state, last_error FROM outbound_messages WHERE id = ?1").bind(messageId).first();
}

describe("the launch alert", () => {
  beforeEach(async () => {
    await env.DB.prepare(
      "INSERT INTO serviceable_pincodes (pincode, area, city, served) VALUES ('122018', 'Sector 65', 'Gurgaon', 1)",
    ).run();
  });

  it("ends with the link that stops launch alerts", async () => {
    const { provider, sent } = recordingProvider();
    expect(await send(await queued("launch_alert", "122018"), provider)).toMatchObject({ state: "sent" });

    const link = new URL(sent[0]?.stopLink ?? "");
    expect(`${link.origin}${link.pathname}`).toBe("http://localhost:4321/stop");
    expect((await stop(link.hash.slice(1))).status).toBe(200);
    expect(await latest("whatsapp_launches")).toMatchObject({ granted: 0, source: "message_link" });
  });

  it("is not sent once its consent is withdrawn, though it was queued before", async () => {
    const messageId = await queued("launch_alert", "122018");
    await stop(await tokenFor("whatsapp_launches"));
    const { provider, sent } = recordingProvider();

    expect(await send(messageId, provider)).toEqual({
      state: "skipped",
      last_error: "no consent to WhatsApp about launches",
    });
    expect(sent).toEqual([]);
  });
});

describe("the answer to a STOP reply", () => {
  it("is sent with the first name, and no link, to a number off staging's allowlist", async () => {
    const { provider, sent } = recordingProvider();
    const config = {
      ...LOCAL_CONFIG,
      settings: { ...LOCAL_SETTINGS, messaging: { ...LOCAL_SETTINGS.messaging, allowlist: ["+919810000099"] } },
    };
    const messageId = await queued("messages_stopped", "consent-1");

    await sendMessage(env.DB, config, fakeDependencies({ messaging: provider }), createLogger(), messageId);

    expect(sent).toEqual([{ to: MOBILE, template: "messages_stopped_v1", params: ["Karan"] }]);
  });
});
