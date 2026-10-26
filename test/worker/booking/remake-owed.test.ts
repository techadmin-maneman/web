// A fit left partly done is owed again free (docs/decisions/0192-free-remakes.md): the payment stays with it and ops
// book the refit, so the app sells the client no second fit meanwhile, nor a replacement while one is owed free. NOW is
// Monday 21 September 2026, 12 noon in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { appFor, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";
import { IMRAN, client, technician, visit } from "./client-booking-fixtures.ts";
import { aPackage } from "../fixtures/index.ts";

let app: App;

beforeEach(async () => {
  await markDatabase();
  app = appFor("local", fakeDependencies(), {}, "client");
  await technician(IMRAN, "Imran Qureshi", "IQ");
  await aPackage({ code: "premium", name: "Premium", firstFit: 4_000_000, serviceVisit: 250_000 });
});

/** The client's first fit, closed "Can't fit today": partly done, for want of a piece. */
async function fitLeftPartly(personId: string): Promise<string> {
  const id = await visit(personId, "first_fit", "terminated", "2026-09-15T04:30:00.000Z", IMRAN);
  await env.DB.prepare(
    `INSERT INTO visit_outcomes (id, appointment_id, started_at, ended_at, duration_minutes, outcome, partial_reason,
       updated_at)
     VALUES (?1, ?2, ?3, ?3, 20, 'partial', 'no_piece', ?3)`,
  )
    .bind(crypto.randomUUID(), id, "2026-09-15T04:50:00.000Z")
    .run();
  return id;
}

const firstFits = (who: { cookie: string }) =>
  request(app, "/api/availability?type=first_fit&tier=premium", { headers: { Cookie: who.cookie } });

describe("a fit left partly done", () => {
  it("sells the client no second fit while its refit is owed", async () => {
    const lead = await client(true, { lastWith: IMRAN });
    expect((await firstFits(lead)).status).toBe(200);
    await fitLeftPartly(lead.id);

    expect((await firstFits(lead)).status).toBe(422);
    const held = await request(app, "/api/holds", {
      method: "POST",
      headers: { Cookie: lead.cookie, "Content-Type": "application/json", Origin: "https://maneman.test" },
      body: JSON.stringify({ type: "first_fit", tier: "premium", date: "2026-09-24", window: "morning" }),
    });
    expect(held.status).toBe(422);
  });

  it("sells one again once ops have closed the refit's Tasks row without booking it", async () => {
    const lead = await client(true, { lastWith: IMRAN });
    const fit = await fitLeftPartly(lead.id);
    await env.DB.prepare(
      `INSERT INTO task_closures (id, task_group, subject_id, reason, closed_by, closed_at)
       VALUES (?1, 'partial_visit', ?2, 'Client chose another hair system', 'ops@maneman.test', ?3)`,
    )
      .bind(crypto.randomUUID(), fit, NOW.toISOString())
      .run();
    expect((await firstFits(lead)).status).toBe(200);
  });
});
