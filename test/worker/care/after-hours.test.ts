// The after-hours answer (src/domain/care/after-hours.ts, src/routes/hooks/evolution.ts;
// docs/decisions/0133-the-after-hours-reply.md): a message sent while Care are off is answered once that night from our
// number with when they are back, and the chat still waits on us. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { Settings } from "../../../src/config/settings.ts";
import { indiaInstant } from "../../../src/lib/india-time.ts";
import type { MessagingProvider } from "../../../src/providers/messaging/index.ts";
import { appFor, captureLogs, fakeDependencies, fakeQueue, LOCAL_SETTINGS, markDatabase, request } from "../helpers.ts";
import { insertPerson } from "../tryon-fixtures.ts";

const TOKEN = "a-webhook-token-of-at-least-thirty-two-chars";
const EVOLUTION: NonNullable<Settings["messaging"]["evolution"]> = {
  baseUrl: "https://bridge.example",
  apiKey: "evolution-instance-key",
  instance: "maneman",
  webhookToken: TOKEN,
};
const ANSWER = "Thank you for your message.\nOur team is back at 9 am and will reply by 10 am.";

let sent: { to: string; text: string }[];

const messaging = (): MessagingProvider => ({
  send: () => Promise.resolve({ ok: true, providerMessageId: "wa-1" }),
  connection: () => Promise.resolve({ open: true }),
  reply: (to, text) => {
    sent.push({ to, text });
    return Promise.resolve({ ok: true, providerMessageId: `wa-r${String(sent.length)}` });
  },
});

/** A message to our number at an India time, as the bridge posts it; `settings` changes messaging's own. */
const written = (text: string, date: string, time: string, settings: Partial<Settings["messaging"]> = {}) =>
  request(
    appFor("local", fakeDependencies({ messaging: messaging(), now: () => indiaInstant(date, time) }), {
      messaging: { ...LOCAL_SETTINGS.messaging, evolution: EVOLUTION, ...settings },
    }),
    `/api/hooks/evolution/${TOKEN}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "messages.upsert",
        instance: "maneman",
        data: {
          key: { remoteJid: "919810000001@s.whatsapp.net", fromMe: false, id: crypto.randomUUID() },
          message: { conversation: text },
          messageType: "conversation",
        },
      }),
    },
    { MESSAGE_QUEUE: fakeQueue() },
  );

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  sent = [];
  await insertPerson("p1", "+919810000001", "Arjun Mehta");
});

describe("the after-hours answer", () => {
  it("answers a message sent after Care close, once that night, and keeps it in the chat as automatic", async () => {
    await written("Is tomorrow still on?", "2026-10-12", "22:10");
    await written("Also, can I move it?", "2026-10-12", "23:40");
    await written("Hello?", "2026-10-13", "07:30");
    expect(sent).toEqual([{ to: "+919810000001", text: ANSWER }]);
    const { results } = await env.DB.prepare(
      "SELECT direction, author, text, delivery FROM chat_messages WHERE direction = 'out'",
    ).all();
    expect(results).toEqual([{ direction: "out", author: "auto", text: ANSWER, delivery: "sent" }]);
  });

  it("leaves the chat waiting on us, with the client's last message its last line", async () => {
    await written("Is tomorrow still on?", "2026-10-12", "22:10");
    const row = await env.DB.prepare("SELECT state FROM conversations").first();
    expect(row).toEqual({ state: "open" });
  });

  it("answers again the next night, and never in hours", async () => {
    await written("Is tomorrow still on?", "2026-10-12", "22:10");
    await written("Thanks!", "2026-10-13", "12:00");
    await written("One more thing", "2026-10-13", "21:30");
    expect(sent).toHaveLength(2);
  });

  it("sends nothing while messaging is off", async () => {
    await written("Is tomorrow still on?", "2026-10-12", "22:10", { enabled: false });
    expect(sent).toEqual([]);
  });

  it("is held back, as every automatic message is, from a number off staging's allowlist", async () => {
    await written("Is tomorrow still on?", "2026-10-12", "22:10", { allowlist: ["+919810000099"] });
    expect(sent).toEqual([]);
    await written("Still there?", "2026-10-12", "22:40", { allowlist: ["+919810000001"] });
    expect(sent).toEqual([{ to: "+919810000001", text: ANSWER }]);
  });

  it("leaves a STOP to its own answer", async () => {
    await written("STOP", "2026-10-12", "22:10");
    expect(sent).toEqual([]);
  });
});
