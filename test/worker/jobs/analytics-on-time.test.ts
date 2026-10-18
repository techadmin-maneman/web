// A visit is on time in the nightly copy (src/domain/analytics/rows.ts) when its technician checked in by the end of
// the client's arrival window: half an hour after the start, here, whatever the visit's length.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { visitRows } from "../../../src/domain/analytics/rows.ts";
import { aTechnician, aVisit } from "../fixtures/index.ts";
import { markDatabase } from "../helpers.ts";

const TECHNICIAN = "a2000000-0000-4000-8000-000000000001";

/** A service visit done, starting at 10:30 am on 22 September, India's clock, and checked in at `checkedIn`. */
async function visitCheckedIn(id: string, checkedIn: string): Promise<void> {
  await aVisit({ id, status: "completed", technician_id: TECHNICIAN });
  await env.DB.prepare(
    `INSERT INTO checkins (id, appointment_id, technician_id, at, radius_m, passed, created_at)
     VALUES (?1, ?2, ?3, ?4, 200, 1, ?4)`,
  )
    .bind(crypto.randomUUID(), id, TECHNICIAN, checkedIn)
    .run();
}

beforeEach(async () => {
  await markDatabase();
  await aTechnician({ id: TECHNICIAN });
});

describe("a visit on time", () => {
  it("is checked in by the end of the arrival window, and late after it, though the visit still runs", async () => {
    const [inside, after] = ["a3000000-0000-4000-8000-000000000001", "a3000000-0000-4000-8000-000000000002"];
    await visitCheckedIn(inside, "2026-09-22T05:25:00.000Z");
    await visitCheckedIn(after, "2026-09-22T05:40:00.000Z");

    const { rows } = await visitRows(env.DB, new Map(), 30);
    const onTime = Object.fromEntries(rows.map((row) => [String(row.visit_key), row.is_on_time]));
    expect(onTime).toEqual({ [inside]: true, [after]: false });
  });
});
