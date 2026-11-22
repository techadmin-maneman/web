// A city's drafts on a day, re-planned and written (src/domain/booking/replan-day.ts, ADR 0290). NOW is Monday 21
// September 2026, 12 noon in India. Every name and number is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { lockDueDrafts, replanAhead } from "../../../src/domain/booking/allotment-lock.ts";
import { replanDay } from "../../../src/domain/booking/replan-day.ts";
import { readOpsInputs } from "../../../src/domain/platform/ops-settings.ts";
import { indiaInstant } from "../../../src/lib/india-time.ts";
import { markDatabase, NOW } from "../helpers.ts";
import { client, IMRAN, SANA, SANDEEP, technician, visit } from "./client-booking-fixtures.ts";

/** A home, as ops set one: 28.4775 is 2 km north of the client, 28.5674 12 km. */
async function home(id: string, lat: number) {
  await env.DB.prepare("UPDATE technicians SET home_lat = ?2, home_lng = 77.0266, home_label = 'Home' WHERE id = ?1")
    .bind(id, lat)
    .run();
}

const TUESDAY = "2026-09-22";
let visitId: string;

beforeEach(async () => {
  await markDatabase();
  await technician(IMRAN, "Imran Qureshi", "IQ");
  await technician(SANDEEP, "Sandeep Rawat", "SR");
  // Sana, switched off since, did the client's last visit, so the rotation bars neither of the others.
  await technician(SANA, "Sana Mirza", "SM");
  await env.DB.prepare("UPDATE technicians SET active = 0 WHERE id = ?1").bind(SANA).run();
  await home(IMRAN, 28.4775);
  await home(SANDEEP, 28.5674);
  const rohit = (await client()).id;
  await env.DB.prepare("UPDATE addresses SET lat = 28.4595, lng = 77.0266 WHERE person_id = ?1").bind(rohit).run();
  // Booked with Sandeep, 12 km away and in his ring, though Imran lives 2 km from the client.
  visitId = await visit(rohit, "service", "scheduled", indiaInstant(TUESDAY, "11:00").toISOString(), SANDEEP);
  await env.DB.prepare(
    "UPDATE appointments SET technician_draft = 1, service_city = 'Gurgaon', service_pincode = '122018' WHERE id = ?1",
  )
    .bind(visitId)
    .run();
});

const visitRow = () =>
  env.DB.prepare("SELECT technician_id, technician_draft FROM appointments WHERE id = ?1").bind(visitId).first();

describe("a day's drafts re-planned", () => {
  it("gives a draft to whoever it costs least, keeps it a draft, and records the move with no claim left", async () => {
    const moved = await replanDay(env.DB, {
      city: "Gurgaon",
      date: TUESDAY,
      now: NOW,
      inputs: await readOpsInputs(env.DB, NOW),
    });
    expect(moved).toBe(1);
    expect(await visitRow()).toEqual({ technician_id: IMRAN, technician_draft: 1 });
    expect(
      await env.DB.prepare("SELECT was_technician_id, now_technician_id, reason, actor FROM dispatch_moves").all(),
    ).toMatchObject({
      results: [{ was_technician_id: SANDEEP, now_technician_id: IMRAN, reason: "zone_rebalance", actor: "allotment" }],
    });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM slot_claims").first())?.n).toBe(0);
  });

  it("never gives a draft to whoever did the client's visit before it", async () => {
    await env.DB.prepare("UPDATE appointments SET technician_id = ?1 WHERE status = 'completed'").bind(IMRAN).run();
    const moved = await replanDay(env.DB, {
      city: "Gurgaon",
      date: TUESDAY,
      now: NOW,
      inputs: await readOpsInputs(env.DB, NOW),
    });
    expect(moved).toBe(0);
    expect(await visitRow()).toEqual({ technician_id: SANDEEP, technician_draft: 1 });
  });

  it("never moves a visit already fixed", async () => {
    await env.DB.prepare("UPDATE appointments SET technician_draft = 0 WHERE id = ?1").bind(visitId).run();
    const moved = await replanDay(env.DB, {
      city: "Gurgaon",
      date: TUESDAY,
      now: NOW,
      inputs: await readOpsInputs(env.DB, NOW),
    });
    expect(moved).toBe(0);
    expect(await visitRow()).toEqual({ technician_id: SANDEEP, technician_draft: 0 });
  });

  it("re-plans tomorrow in the evening's lock before fixing it", async () => {
    const evening = indiaInstant("2026-09-21", "18:05");
    const inputs = await readOpsInputs(env.DB, evening);
    await lockDueDrafts(env.DB, evening, {
      readHours: () => Promise.resolve({ national: 18, cities: new Map<string, number>() }),
      replan: (city, date) => replanDay(env.DB, { city, date, now: evening, inputs }),
      failed: () => undefined,
    });
    expect(await visitRow()).toEqual({ technician_id: IMRAN, technician_draft: 0 });
  });

  it("fixes tomorrow as it stands where its re-plan fails, and says which city failed", async () => {
    const failed: string[] = [];
    await lockDueDrafts(env.DB, indiaInstant("2026-09-21", "18:05"), {
      readHours: () => Promise.resolve({ national: 18, cities: new Map<string, number>() }),
      replan: () => Promise.reject(new Error("D1 overloaded")),
      failed: (city) => failed.push(city),
    });
    expect(failed).toEqual(["Gurgaon"]);
    expect(await visitRow()).toEqual({ technician_id: SANDEEP, technician_draft: 0 });
  });
});

describe("the night's re-plan", () => {
  it("re-plans each city's days ahead, leaves them drafts, and goes on past a day that fails", async () => {
    const inputs = await readOpsInputs(env.DB, NOW);
    const thursday = await visit(
      null,
      "service",
      "scheduled",
      indiaInstant("2026-09-24", "11:00").toISOString(),
      IMRAN,
    );
    await env.DB.prepare("UPDATE appointments SET technician_draft = 1, service_city = 'Noida' WHERE id = ?1")
      .bind(thursday)
      .run();
    const failed: string[] = [];
    const moved = await replanAhead(env.DB, NOW, {
      replan: (city, date) =>
        city === "Noida"
          ? Promise.reject(new Error("D1 overloaded"))
          : replanDay(env.DB, { city, date, now: NOW, inputs }),
      failed: (city) => failed.push(city),
    });
    expect({ moved, failed }).toEqual({ moved: 1, failed: ["Noida"] });
    expect(await visitRow()).toEqual({ technician_id: IMRAN, technician_draft: 1 });
  });
});
