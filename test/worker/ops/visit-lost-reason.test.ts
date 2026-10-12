// Why a client is not going ahead after their consultation, set on the client's page (src/routes/ops/visit-lost-reason.ts;
// docs/decisions/0149-lost-reasons.md). NOW is Monday 21 September 2026, 12 noon in India. Every name is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { LOST_REASONS } from "../../../src/config/job-sheet.ts";
import type { App } from "../../../src/http/context.ts";
import { appFor, captureLogs, fakeDependencies, markDatabase, request } from "../helpers.ts";
import { MOBILE, PERSON, person, record, VISIT } from "./ops-clients-fixtures.ts";

let ops: App;

const set = (lostReason: string | null, visit = VISIT) =>
  request(ops, `/api/visits/${visit}/lost-reason`, {
    method: "POST",
    headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
    body: JSON.stringify({ lost_reason: lostReason }),
  });

interface Record {
  visits: { past: { id: string; lost_reason: unknown }[] };
  lost_reasons: { code: string; label: string }[];
}

const recorded = async () => (await request(ops, `/api/clients/${PERSON}`)).json<Record>();

beforeEach(async () => {
  captureLogs();
  ops = appFor("local", fakeDependencies(), {}, "ops");
  await markDatabase();
  await person(PERSON, "Rohit Malhotra", MOBILE);
  await record();
});

describe("a closed consultation's reason", () => {
  it("is set and cleared on the client's page, shown in ops' words, and audited", async () => {
    await env.DB.prepare("UPDATE appointments SET type = 'consultation' WHERE id = ?1").bind(VISIT).run();

    expect((await set("price")).status).toBe(200);
    const once = await recorded();
    expect(once.visits.past.find((visit) => visit.id === VISIT)?.lost_reason).toEqual({
      code: "price",
      label: "The price",
    });
    expect(once.lost_reasons.map((reason) => reason.code)).toEqual(LOST_REASONS.map((reason) => reason.id));

    expect((await set(null)).status).toBe(200);
    expect((await recorded()).visits.past.find((visit) => visit.id === VISIT)?.lost_reason).toBeNull();
    const { results } = await env.DB.prepare(
      "SELECT detail FROM audit_log WHERE action = 'visit.lost_reason' ORDER BY id",
    ).all<{ detail: string }>();
    expect(results.map((row) => JSON.parse(row.detail) as unknown)).toEqual([{ reason: "price" }, { reason: null }]);
  });

  it("refuses a code the job sheet never listed, and a visit that is no consultation", async () => {
    expect((await set("price")).status).toBe(404);
    await env.DB.prepare("UPDATE appointments SET type = 'consultation' WHERE id = ?1").bind(VISIT).run();
    const unknown = await set("stars_misaligned");
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({ error: { fields: ["lost_reason"] } });
  });
});
