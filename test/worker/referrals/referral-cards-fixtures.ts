// What the referral card tests share (referral-cards*.test.ts): the referrer, a friend, the referrer's code, the
// console, and a consent given.

import { env } from "cloudflare:workers";
import { appFor, fakeDependencies } from "../helpers.ts";

export const PERSON = "11111111-1111-4111-8111-111111111111";

export const FRIEND = "22222222-2222-4222-8222-222222222222";

export const CODE = "RM7K2Q";

export const ops = () => appFor("local", fakeDependencies(), {}, "ops");

export async function consent(purpose: string, granted: boolean, personId = PERSON) {
  await env.DB.prepare(
    `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
     VALUES (?1, ?2, ?3, 'photos-referral-cards-v2', ?4, ?5)`,
  )
    .bind(crypto.randomUUID(), personId, purpose, granted ? 1 : 0, new Date(Date.now()).toISOString())
    .run();
}
