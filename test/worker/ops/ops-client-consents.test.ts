// One client's record on the ops surface (src/routes/ops/clients.ts): the client
// page, its photographs and its consents, Ops Console B1 to B3. NOW is Monday
// 21 September 2026, 12 noon in India. Every name, number and photograph is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { appFor, captureLogs, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";
import { PERSON, MOBILE, person } from "./ops-clients-fixtures.ts";

let ops: App;

async function consent(purpose: string, granted: 0 | 1, notice: string, at: string, source: string | null = null) {
  await env.DB.prepare(
    `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at, source)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  )
    .bind(crypto.randomUUID(), PERSON, purpose, notice, granted, at, source)
    .run();
}

beforeEach(async () => {
  captureLogs();
  ops = appFor("local", fakeDependencies(), {}, "ops");
  await markDatabase();
  await person(PERSON, "Rohit Malhotra", MOBILE);
});

describe("GET /api/clients/{id}/consents", () => {
  it("gives every purpose its state, notice version, date and where it was given, with any deletion request", async () => {
    await consent("photos_own_record", 1, "photos-own-record-booking-v1", "2026-08-02T06:00:00.000Z", "app_booking");
    await consent("photos_marketing", 1, "photos-marketing-v1", "2026-08-02T06:00:00.000Z");
    await consent("whatsapp_visits", 1, "whatsapp-visits-v1", "2026-08-02T06:00:00.000Z", "app_booking");
    await consent("whatsapp_visits", 0, "whatsapp-visits-v1", "2026-09-01T06:00:00.000Z", "app_profile");
    await env.DB.prepare(
      "INSERT INTO deletion_requests (id, person_id, created_at, state) VALUES (?1, ?2, ?3, 'requested')",
    )
      .bind("66666666-6666-4666-8666-666666666666", PERSON, NOW.toISOString())
      .run();

    const body = await (await request(ops, `/api/clients/${PERSON}/consents`)).json();
    expect(body).toEqual({
      consents: [
        {
          purpose: "photos_own_record",
          state: "given",
          notice_version: "photos-own-record-booking-v1",
          at: "2026-08-02T06:00:00.000Z",
          source: "app_booking",
        },
        { purpose: "photos_referral_cards", state: "not_given", notice_version: null, at: null, source: null },
        // Given before a consent recorded where, so it has no place (docs/decisions/0094-where-a-consent-was-given.md).
        {
          purpose: "photos_marketing",
          state: "given",
          notice_version: "photos-marketing-v1",
          at: "2026-08-02T06:00:00.000Z",
          source: null,
        },
        {
          purpose: "whatsapp_visits",
          state: "withdrawn",
          notice_version: "whatsapp-visits-v1",
          at: "2026-09-01T06:00:00.000Z",
          source: "app_profile",
        },
        { purpose: "whatsapp_launches", state: "not_given", notice_version: null, at: null, source: null },
      ],
      deletion: {
        id: "66666666-6666-4666-8666-666666666666",
        state: "requested",
        requested_at: NOW.toISOString(),
        decided_at: null,
      },
    });
  });
});
