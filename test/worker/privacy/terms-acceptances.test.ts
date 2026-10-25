// The agreement to the terms and the privacy policy every form that books asks for (src/domain/privacy/terms-acceptances.ts):
// kept with the versions the site publishes, refused when it is not given, and never changed. Every name and number here
// is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { LEGAL_VERSIONS } from "../../../src/config/legal-versions.ts";
import { fakeQueue, markDatabase, request } from "../helpers.ts";
import { post, site } from "../site/consultations-fixtures.ts";

const LEFT = { name: "Karan Bhatia", mobile: "9810000002", consent: true, terms: true, turnstile_token: "token" };

const leave = (body: object) =>
  request(site(), "/api/lead", post(body), { CRM_QUEUE: fakeQueue(), MESSAGE_QUEUE: fakeQueue() });

const acceptances = async () =>
  (await env.DB.prepare("SELECT terms_version, privacy_version, source, ip_hash FROM terms_acceptances").all()).results;

beforeEach(async () => {
  await markDatabase();
});

describe("the terms agreed to", () => {
  it("are kept with the versions the site publishes, where they were given, and a hash of the address", async () => {
    expect((await leave(LEFT)).status).toBe(201);
    expect(await acceptances()).toEqual([
      {
        terms_version: LEGAL_VERSIONS.terms,
        privacy_version: LEGAL_VERSIONS.privacy,
        source: "site_booking",
        ip_hash: expect.any(String) as string,
      },
    ]);
  });

  it("refuse a form sent without them, and keep nothing of it", async () => {
    const { terms: _left, ...without } = LEFT;
    for (const body of [without, { ...LEFT, terms: false }]) {
      const answer = await leave(body);
      expect(answer.status).toBe(400);
      expect(await answer.json()).toMatchObject({ error: { code: "invalid_request" } });
    }
    expect(await acceptances()).toEqual([]);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM people").first<{ n: number }>())?.n).toBe(0);
  });

  it("are never changed or deleted", async () => {
    await leave(LEFT);
    await expect(env.DB.prepare("UPDATE terms_acceptances SET terms_version = '0.9'").run()).rejects.toThrow(
      /append-only/,
    );
    await expect(env.DB.prepare("DELETE FROM terms_acceptances").run()).rejects.toThrow(/append-only/);
  });
});
