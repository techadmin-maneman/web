// A payment link sent on WhatsApp (src/domain/money/pay-links.ts; docs/decisions/0300-payment-links-on-whatsapp.md):
// kept under a random token, its message naming what it pays for with our address for it; that address answers
// Razorpay's while the link is open, and nothing for a token closed or guessed, which counts against the address;
// MSG91 is not asked to send it until WhatsApp approves the template.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { Settings } from "../../../src/config/settings.ts";
import type { StaticConfig } from "../../../src/guard.ts";
import type { MessagingProvider, OutboundMessage } from "../../../src/providers/messaging/index.ts";
import { payLinkSentAgain, payLinkStatements } from "../../../src/domain/money/pay-links.ts";
import { sendMessage } from "../../../src/queues/messaging.ts";
import { INVITE_MISSES_PER_ADDRESS_HOURLY } from "../../../src/policy/invites.ts";
import {
  appFor,
  captureLogs,
  fakeDependencies,
  LOCAL_CONFIG,
  LOCAL_SETTINGS,
  markDatabase,
  NOW,
  request,
} from "../helpers.ts";
import { log } from "../messages/messaging-fixtures.ts";
import { insertPerson } from "../tryon-fixtures.ts";

const HOUR = 60 * 60 * 1000;
const SUBJECT = { kind: "hold", id: "h-1" } as const;

function config(messaging: Partial<Settings["messaging"]> = {}): StaticConfig {
  return { ...LOCAL_CONFIG, settings: { ...LOCAL_SETTINGS, messaging: { ...LOCAL_SETTINGS.messaging, ...messaging } } };
}

function recordingProvider() {
  const sent: Pick<OutboundMessage, "template" | "params">[] = [];
  const provider: MessagingProvider = {
    send: ({ template, params }) => {
      sent.push({ template, params });
      return Promise.resolve({ ok: true, providerMessageId: "wa-1" });
    },
    connection: () => Promise.resolve({ open: true }),
  };
  return { provider, sent };
}

/** A held booking's link made now, open for `hours`: its token and the message queued with it. */
async function linkMade(hours = 24): Promise<{ token: string; messageId: string }> {
  await env.DB.batch(
    payLinkStatements(
      env.DB,
      {
        personId: "p",
        subject: SUBJECT,
        url: "https://rzp.io/rzp/S3qAbc",
        amount: 200_000,
        what: "service visit on Thu 23 Sep, 12 pm",
        openUntil: new Date(NOW.getTime() + hours * HOUR),
      },
      NOW,
    ),
  );
  const row = await env.DB.prepare(
    "SELECT l.id AS token, m.id AS message_id FROM pay_links l JOIN outbound_messages m ON m.subject_id = l.id",
  ).first<{ token: string; message_id: string }>();
  return { token: row?.token ?? "", messageId: row?.message_id ?? "" };
}

const send = (messageId: string, settings: StaticConfig = config()) => {
  const { provider, sent } = recordingProvider();
  const next = sendMessage({
    db: env.DB,
    config: settings,
    deps: fakeDependencies({ messaging: provider }),
    log,
    messageId,
  });
  return next.then(() => sent);
};

const site = () => appFor("local", fakeDependencies({ now: () => NOW }), {}, "public");
const ask = (token: string, address = "203.0.113.7") =>
  request(site(), `/api/pay/${token}`, { headers: { "CF-Connecting-IP": address } });

beforeEach(async () => {
  await markDatabase();
  captureLogs();
  await insertPerson("p", "+919810000001", "Arjun Mehta");
});

describe("a payment link's message", () => {
  it("names the amount, what it pays for and until when, with our address for it", async () => {
    const { token, messageId } = await linkMade();
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);

    const sent = await send(messageId);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.template).toBe("payment_link_v1");
    const [name, amount, what, until, link] = sent[0]?.params ?? [];
    expect([name, amount, what, link]).toEqual([
      "Arjun",
      "Rs. 2,000",
      "service visit on Thu 23 Sep, 12 pm",
      `http://localhost:4321/pay/${token}`,
    ]);
    expect(until).toMatch(/^\w{3} \d{1,2} \w{3}, \d{1,2}(:\d{2})?\s(am|pm)$/);
  });

  it("is not sent once its link has closed", async () => {
    const { messageId } = await linkMade(-1);
    expect(await send(messageId)).toEqual([]);
  });

  it("is not asked of MSG91 until WhatsApp approves the template, and is skipped, not failed", async () => {
    const { messageId } = await linkMade();
    const msg91 = { authKey: "test-key", integratedNumber: "919800000000", webhookToken: null };
    expect(await send(messageId, config({ msg91 }))).toEqual([]);
    const row = await env.DB.prepare("SELECT state FROM outbound_messages WHERE id = ?1")
      .bind(messageId)
      .first<{ state: string }>();
    expect(row?.state).toBe("skipped");
  });

  it("goes again under the same token when the link is sent again, and not for a link never sent so", async () => {
    const { token } = await linkMade();
    expect(await payLinkSentAgain(env.DB, SUBJECT, NOW)).toBe(true);
    expect(await payLinkSentAgain(env.DB, { kind: "hold", id: "h-other" }, NOW)).toBe(false);
    const { results } = await env.DB.prepare(
      "SELECT subject_id FROM outbound_messages WHERE kind = 'payment_link'",
    ).all<{ subject_id: string }>();
    expect(results).toEqual([{ subject_id: token }, { subject_id: token }]);
  });
});

describe("our address for a payment link", () => {
  it("answers Razorpay's address while the link is open", async () => {
    const { token } = await linkMade();
    const answer = await ask(token);
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ url: "https://rzp.io/rzp/S3qAbc" });
  });

  it("answers nothing for a link that has closed, or a token never made", async () => {
    const { token } = await linkMade(-1);
    expect((await ask(token)).status).toBe(404);
    expect((await ask("AbCdEfGhIjKlMnOpQrSt_-")).status).toBe(404);
    expect((await ask("short")).status).toBe(400);
  });

  it("refuses an address that has asked for too many tokens that are not open this hour", async () => {
    const { token } = await linkMade();
    for (let miss = 0; miss < INVITE_MISSES_PER_ADDRESS_HOURLY; miss += 1) {
      expect((await ask("AbCdEfGhIjKlMnOpQrSt_-")).status).toBe(404);
    }
    expect((await ask(token)).status).toBe(429);
    expect((await ask(token, "198.51.100.9")).status).toBe(200);
  });
});
