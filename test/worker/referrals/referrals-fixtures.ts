// What the referral tests share (referrals*.test.ts): the referrer and a friend, a pincode served, the client and site
// apps, a referrer's code, and the address a friend types.

import { env } from "cloudflare:workers";
import { openSession } from "../../../src/domain/sign-in/sessions.ts";
import { appFor, fakeDependencies, NOW, request, fittedAndPhotographed } from "../helpers.ts";

export const REFERRER = "11111111-1111-4111-8111-111111111111";

export async function person(id: string, name: string, mobile: string) {
  await env.DB.prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, ?3, ?4)")
    .bind(id, NOW.toISOString(), mobile, name)
    .run();
}

/** A pincode whose area ops have named, unless `named` is false: its name is then still the post offices'. */
export async function pincode(pin: string, area: string, served: boolean, named = true) {
  await env.DB.prepare(
    `INSERT INTO serviceable_pincodes (pincode, area, city, served, launched_at, area_named_by)
     VALUES (?1, ?2, 'Gurgaon', ?3, ?4, ?5)`,
  )
    .bind(pin, area, served ? 1 : 0, served ? "2026-09-01T18:30:00.000Z" : null, named ? "ops@localhost" : null)
    .run();
}

export const client = () => appFor("local", fakeDependencies(), {}, "client");

export const site = (settings = {}) => appFor("local", fakeDependencies(), settings, "public");

export async function codeOf(): Promise<string> {
  await fittedAndPhotographed(REFERRER);
  const cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: REFERRER, deviceLabel: null, now: NOW })}`;
  const answer = await request(client(), "/api/refer", { headers: { Cookie: cookie } });
  return (await answer.json<{ code: string }>()).code;
}

export const post = (body: object) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.7" },
  body: JSON.stringify(body),
});

export const FRIEND = { name: "Karan Bhatia", mobile: "98100 00002", turnstile_token: "token" };

/** Where the friend's consultation is, typed in full as the landing takes it (ADR 0081). */
export const ADDRESS = {
  flat: "Flat 402",
  line1: "Palm Grove Society",
  line2: null,
  locality: "Sector 65",
  city: "Gurgaon",
  pincode: "122018",
  access_notes: null,
};
