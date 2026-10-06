// createChallenge, the one maker of a one-time-code challenge, for a client and for a technician. Every name and
// number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { checkLoginCode, createChallenge, type ChallengeHolder } from "../../../src/domain/sign-in/one-time-codes.ts";
import { markDatabase, NOW } from "../helpers.ts";

const PERSON = "66666666-6666-4666-8666-666666666666";
const TECHNICIAN = "77777777-7777-4777-8777-777777777777";
const PEPPER = "test-pepper";
const CODE = "482913";

beforeEach(async () => {
  await markDatabase();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000066', 'Rohan Mehta')",
    ).bind(PERSON, NOW.toISOString()),
    env.DB.prepare(
      "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES (?1, 'resource-7', 'Arjun Rao', 'AR', 1, ?2)",
    ).bind(TECHNICIAN, NOW.toISOString()),
  ]);
});

function challengeFor(holder: ChallengeHolder, holderId: string | null) {
  return createChallenge(env.DB, { holder, holderId, code: CODE, pepper: PEPPER, now: NOW });
}

function check(challengeId: string, holder: ChallengeHolder) {
  return checkLoginCode(env.DB, { challengeId, code: CODE, pepper: PEPPER, now: NOW, purpose: "login", holder });
}

describe("createChallenge", () => {
  it("makes a client's challenge that only a client's check answers", async () => {
    const challenge = await challengeFor("person", PERSON);

    expect(challenge.holderId).toBe(PERSON);
    expect(await check(challenge.id, "technician")).toEqual({ outcome: "closed" });
    expect(await check(challenge.id, "person")).toEqual({ outcome: "verified", holderId: PERSON });
  });

  it("makes a technician's challenge that only a technician's check answers", async () => {
    const challenge = await challengeFor("technician", TECHNICIAN);

    expect(challenge.holderId).toBe(TECHNICIAN);
    expect(await check(challenge.id, "person")).toEqual({ outcome: "closed" });
    expect(await check(challenge.id, "technician")).toEqual({ outcome: "verified", holderId: TECHNICIAN });
  });

  it("keeps no code for a number that is no one's, so the right code still does not match", async () => {
    const challenge = await challengeFor("person", null);

    expect(challenge.holderId).toBeNull();
    expect(await check(challenge.id, "person")).toMatchObject({ outcome: "mismatch" });
  });

  it("expires ten minutes after it is made", async () => {
    const challenge = await challengeFor("technician", TECHNICIAN);

    expect(challenge.expiresAt.getTime() - NOW.getTime()).toBe(10 * 60 * 1000);
  });
});
