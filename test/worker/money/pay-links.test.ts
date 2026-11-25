// A payment link sent on WhatsApp (src/domain/money/pay-links.ts; docs/decisions/0300-payment-links-on-whatsapp.md):
// kept under a random token, its message naming what it pays for with our address for it; that address answers
// Razorpay's while the link is open, and nothing for a token closed or guessed, which counts against the address;
// MSG91 sends it, WhatsApp having approved its template.

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
import { aPerson } from "../fixtures/index.ts";

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
  await aPerson({ id: "p", mobile_e164: "+919810000001", name: "Arjun Mehta" });
});

describe("a payment link's message", () => {
  it("names the amount, what it pays for and until when, with our address for it", async () => {
    const { token, messageId } = await linkMade();
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    // WhatsApp's alone: no alert or push in the app beside it, whose cards show the link already.
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM client_app_alerts").first<number>("n")).toBe(0);

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

  it("is asked of MSG91, WhatsApp having approved its template", async () => {
    const { messageId } = await linkMade();
    const msg91 = { authKey: "test-key", integratedNumber: "919800000000", webhookToken: null };
    const sent = await send(messageId, config({ msg91 }));
    expect(sent.map((message) => message.template)).toEqual(["payment_link_v1"]);
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

  // A carrier puts many clients behind one address: one's misses never keep another from an open link.
  it("refuses an address past its misses only a token that is not open, never an open one", async () => {
    const { token } = await linkMade();
    for (let miss = 0; miss < INVITE_MISSES_PER_ADDRESS_HOURLY; miss += 1) {
      expect((await ask("AbCdEfGhIjKlMnOpQrSt_-")).status).toBe(404);
    }
    expect((await ask("AbCdEfGhIjKlMnOpQrSt_-")).status).toBe(429);
    expect((await ask(token)).status).toBe(200);
    expect((await ask("AbCdEfGhIjKlMnOpQrSt_-", "198.51.100.9")).status).toBe(404);
  });
});
