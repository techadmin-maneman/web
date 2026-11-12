// The figures the client app's words are made of come from what ops set, never from the app (the client redesign's
// brief, "Every number from the console"): Care's hours, the fit guarantee, and what the account promises. NOW is Monday
// 21 September 2026, 12 noon in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { appFor, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";
import { IMRAN, SANA, client, technician, visit } from "../booking/client-booking-fixtures.ts";

let app: App;

beforeEach(async () => {
  await markDatabase();
  app = appFor("local", fakeDependencies(), {}, "client");
  await technician(IMRAN, "Imran Qureshi", "IQ");
  await technician(SANA, "Sana Mirza", "SM");
});

const setRule = (name: string, value: unknown) =>
  env.DB.prepare("INSERT INTO ops_settings (name, value, set_by, set_at) VALUES (?1, ?2, 'ops@localhost', ?3)")
    .bind(name, JSON.stringify(value), NOW.toISOString())
    .run();

const get = async <T>(who: { cookie: string }, path: string) =>
  (await request(app, path, { headers: { Cookie: who.cookie } })).json<T>();

/** A visit closed done, as the technician's outcome closes it. */
async function closedDone(appointmentId: string, at: string) {
  await env.DB.prepare(
    `INSERT INTO visit_outcomes (id, appointment_id, started_at, ended_at, duration_minutes, outcome, updated_at)
     VALUES (?1, ?2, ?3, ?3, 120, 'done', ?3)`,
  )
    .bind(crypto.randomUUID(), appointmentId, at)
    .run();
}

describe("Home's figures", () => {
  it("are the committed ones until ops set others", async () => {
    const rohit = await client();
    expect(await get(rohit, "/api/me")).toMatchObject({
      care_hours: { opens: 9, closes: 21, first_reply: 60 },
      guarantee_days: 14,
      answers_within: { grievance_days: 30, deletion_days: 30, invoices_kept_years: 8 },
    });
  });

  it("follow the console without a release", async () => {
    const rohit = await client();
    await setRule("guarantee_days", 21);
    await setRule("care_hours", { opens: 10, closes: 20, first_reply: 30, answered_by: 11 });
    expect(await get(rohit, "/api/me")).toMatchObject({
      care_hours: { opens: 10, closes: 20, first_reply: 30 },
      guarantee_days: 21,
    });
  });
});

describe("a visit's guarantee", () => {
  it("runs from a first fit done, the day itself the first of the days ops set", async () => {
    const rohit = await client();
    const fit = await visit(rohit.id, "first_fit", "completed", "2026-09-10T04:30:00.000Z", IMRAN);
    await closedDone(fit, "2026-09-10T07:00:00.000Z");
    expect(await get(rohit, `/api/visits/${fit}`)).toMatchObject({ guarantee_until: "2026-09-23" });

    await setRule("guarantee_days", 21);
    // A fresh Worker, as one past the minute the console's figures are kept for.
    app = appFor("local", fakeDependencies(), {}, "client");
    expect(await get(rohit, `/api/visits/${fit}`)).toMatchObject({ guarantee_until: "2026-09-30" });
  });

  it("is none for any other visit", async () => {
    const rohit = await client();
    const service = await visit(rohit.id, "service", "completed", "2026-09-10T04:30:00.000Z", IMRAN);
    await closedDone(service, "2026-09-10T06:00:00.000Z");
    expect(await get(rohit, `/api/visits/${service}`)).toMatchObject({ guarantee_until: null });
  });
});
