// Ops' funnel counts an invite's opens (GET /api/r/:code). A chat app fetching the link to draw its preview is not
// a person opening it, and the site's Worker passes the visitor's user agent on so the API can tell (FEO-25).
// NOW is Monday 21 September 2026, 12 noon in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { openSession } from "../../src/domain/sessions.ts";
import { appFor, captureLogs, fakeDependencies, markDatabase, NOW, request } from "./helpers.ts";

const REFERRER = "11111111-1111-4111-8111-111111111111";

const client = () => appFor("local", fakeDependencies(), {}, "client");
const site = () => appFor("local", fakeDependencies(), {}, "public");

async function inviteCode(): Promise<string> {
  await env.DB.prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, ?3, ?4)")
    .bind(REFERRER, NOW.toISOString(), "+919810000001", "Rohit Malhotra")
    .run();
  const session = await openSession(env.DB, { kind: "client", subjectId: REFERRER, deviceLabel: null, now: NOW });
  const answer = await request(client(), "/api/refer", { headers: { Cookie: `mm_app=${session}` } });
  return (await answer.json<{ code: string }>()).code;
}

async function opens(code: string): Promise<number> {
  const row = await env.DB.prepare("SELECT opens FROM referral_codes WHERE code = ?1")
    .bind(code)
    .first<{ opens: number }>();
  return row?.opens ?? -1;
}

beforeEach(async () => {
  await markDatabase();
  captureLogs();
});

it("counts a person opening the invite, and not a chat app drawing its preview", async () => {
  const code = await inviteCode();
  const open = (agent: string) => request(site(), `/api/r/${code}`, { headers: { "User-Agent": agent } });

  await open(
    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36",
  );
  expect(await opens(code)).toBe(1);

  for (const preview of [
    "WhatsApp/2.23.20.0 A",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "TelegramBot (like TwitterBot)",
    "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
    "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
    "LinkedInBot/1.0 (compatible; Mozilla/5.0)",
    "Twitterbot/1.0",
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  ]) {
    const answer = await open(preview);
    expect(await answer.json(), preview).toMatchObject({ state: "valid" });
  }
  expect(await opens(code)).toBe(1);
});
