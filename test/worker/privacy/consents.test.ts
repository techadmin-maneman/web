// recordConsent, the one writer of consents, under each of its three rules. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { recordConsent, type ConsentAnswer, type ConsentRule } from "../../../src/domain/consents.ts";
import { markDatabase, NOW } from "../helpers.ts";

const PERSON = "55555555-5555-4555-8555-555555555555";
const MOBILE = "+919810000055";

function answer(rule: ConsentRule, overrides: Partial<ConsentAnswer> = {}): ConsentAnswer {
  return {
    person: { id: PERSON },
    purpose: "whatsapp_launches",
    granted: true,
    notice: "whatsapp-launches-v1",
    source: "site_waitlist",
    rule,
    ipHash: "ip-hash",
    givenAt: NOW.toISOString(),
    ...overrides,
  };
}

/** Runs the write and returns the created_at it answered, or null where it added no row. */
async function record(given: ConsentAnswer): Promise<string | null> {
  const [result] = await env.DB.batch<{ created_at: string }>([recordConsent(env.DB, given).statement]);
  return result?.results[0]?.created_at ?? null;
}

const ledger = async () =>
  (
    await env.DB.prepare(
      "SELECT purpose, granted, notice_version, source, ip_hash FROM consents WHERE person_id = ?1 ORDER BY rowid",
    )
      .bind(PERSON)
      .all()
  ).results;

beforeEach(async () => {
  await markDatabase();
  await env.DB.prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, ?3, 'Kabir Anand')")
    .bind(PERSON, NOW.toISOString(), MOBILE)
    .run();
});

describe("recordConsent", () => {
  it("always adds a row under 'always', with what was given and where", async () => {
    expect(await record(answer("always"))).toBe(NOW.toISOString());
    expect(await record(answer("always"))).toBe(NOW.toISOString());
    expect(await ledger()).toEqual([
      {
        purpose: "whatsapp_launches",
        granted: 1,
        notice_version: "whatsapp-launches-v1",
        source: "site_waitlist",
        ip_hash: "ip-hash",
      },
      {
        purpose: "whatsapp_launches",
        granted: 1,
        notice_version: "whatsapp-launches-v1",
        source: "site_waitlist",
        ip_hash: "ip-hash",
      },
    ]);
  });

  it("adds no row under 'if_changed' when the latest answer and notice are the same", async () => {
    expect(await record(answer("if_changed"))).not.toBeNull();
    expect(await record(answer("if_changed"))).toBeNull();
    expect(await record(answer("if_changed", { granted: false }))).not.toBeNull();
    expect(await record(answer("if_changed", { granted: false, notice: "whatsapp-launches-v2" }))).not.toBeNull();
    expect((await ledger()).map((row) => [row.granted, row.notice_version])).toEqual([
      [1, "whatsapp-launches-v1"],
      [0, "whatsapp-launches-v1"],
      [0, "whatsapp-launches-v2"],
    ]);
  });

  it("never overrides a decision under 'if_undecided', a refusal included", async () => {
    await record(answer("always", { granted: false }));
    expect(await record(answer("if_undecided"))).toBeNull();
    expect((await ledger()).map((row) => row.granted)).toEqual([0]);
  });

  it("records an undecided purpose under 'if_undecided'", async () => {
    expect(await record(answer("if_undecided"))).toBe(NOW.toISOString());
    expect((await ledger()).map((row) => row.granted)).toEqual([1]);
  });

  it("applies the rule in the write, so two taps in one batch add one row", async () => {
    const write = () => recordConsent(env.DB, answer("if_changed")).statement;
    await env.DB.batch([write(), write()]);
    expect(await ledger()).toHaveLength(1);
  });

  it("finds the person by number, for a batch that writes the person too", async () => {
    expect(await record(answer("always", { person: { mobileE164: MOBILE }, source: "try_on" }))).not.toBeNull();
    expect((await ledger()).map((row) => row.source)).toEqual(["try_on"]);
  });
});
