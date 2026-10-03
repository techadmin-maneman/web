// Ops' funnel counts an invite's opens (GET /api/r/:code). A chat app fetching the link to draw its preview is not
// a person opening it, and the site's Worker passes the visitor's user agent on so the API can tell (FEO-25). An
// address counts once a day for each invite, and one guessing codes is refused every code for the rest of the hour.
// NOW is Monday 21 September 2026, 12 noon in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { openSession } from "../../src/domain/sessions.ts";
import { DAY_MS, HOUR_MS } from "../../src/lib/durations.ts";
import { INVITE_MISSES_PER_ADDRESS_HOURLY } from "../../src/policy/invites.ts";
import { appFor, captureLogs, fakeDependencies, markDatabase, NOW, request } from "./helpers.ts";

const REFERRER = "11111111-1111-4111-8111-111111111111";
const BROWSER =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36";

const client = () => appFor("local", fakeDependencies(), {}, "client");
const site = (now = NOW) => appFor("local", fakeDependencies({ now: () => now }), {}, "public");

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

function lookUp(code: string, address: string, now = NOW): Promise<Response> {
  return request(site(now), `/api/r/${code}`, { headers: { "User-Agent": BROWSER, "CF-Connecting-IP": address } });
}

beforeEach(async () => {
  await markDatabase();
  captureLogs();
});

it("counts a person opening the invite, and not a chat app drawing its preview", async () => {
  const code = await inviteCode();
  const open = (agent: string) => request(site(), `/api/r/${code}`, { headers: { "User-Agent": agent } });

  await open(BROWSER);
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

// PLAT-17: a reload, or a loop, writes nothing more to the funnel.
it("counts an open once a day for each address", async () => {
  const code = await inviteCode();

  await lookUp(code, "203.0.113.7");
  await lookUp(code, "203.0.113.7");
  expect(await opens(code)).toBe(1);

  await lookUp(code, "198.51.100.4");
  expect(await opens(code)).toBe(2);

  await lookUp(code, "203.0.113.7", new Date(NOW.getTime() + DAY_MS));
  expect(await opens(code)).toBe(3);
});

// PS-54: guessing codes reveals referrers' first names and cards.
it("refuses an address every code once its misses for the hour are spent, and no other address", async () => {
  const code = await inviteCode();
  for (let guess = 0; guess < INVITE_MISSES_PER_ADDRESS_HOURLY; guess += 1) {
    const missed = await lookUp(`ZZ${String(guess).padStart(4, "0")}`, "203.0.113.7");
    expect(await missed.json()).toMatchObject({ state: "unknown" });
  }

  const refused = await lookUp(code, "203.0.113.7");
  expect(refused.status).toBe(429);
  expect(await refused.json()).toMatchObject({ error: { code: "rate_limited" } });
  expect(await opens(code)).toBe(0);

  expect(await (await lookUp(code, "198.51.100.4")).json()).toMatchObject({ state: "valid" });
  const nextHour = await lookUp(code, "203.0.113.7", new Date(NOW.getTime() + HOUR_MS));
  expect(await nextHour.json()).toMatchObject({ state: "valid" });
});
