// A client's hair profile (docs/decisions/0106-a-clients-hair-profile.md): the technician records the fit spec and the
// history at a consultation and at a one visit, on no consent of its own, as the owner ruled; every change is a new
// version; ops read every version and correct the latest on the client's page; an erasure blanks them, and the export
// carries them. None of it reaches FSM, a log line or the audit log. NOW is Monday 21 September 2026, 12 noon in
// India; the visit is today at 13:00. Every name and number is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { openSession } from "../../src/domain/sessions.ts";
import { summaryOf } from "../../src/domain/job-sheet.ts";
import { appFor, captureLogs, eraseByMobile, fakeDependencies, markDatabase, NOW, request } from "./helpers.ts";
import { IMRAN, JOB, PERSON, SAMEER, working, type Working } from "./job-fixtures.ts";

const PROFILE = `/api/tech/jobs/${JOB}/profile`;
const CONSOLE = `/api/clients/${PERSON}/hair-profile`;

const FIT = {
  norwood_stage: "IV",
  head_circumference_cm: 57.5,
  front_to_nape_cm: 36,
  ear_to_ear_cm: 33.5,
  temple_to_temple_cm: 34,
  base_width_in: 8,
  base_length_in: 10,
  colour: "1B",
  grey_percent: 20,
  density_percent: 120,
  wave: "slight_wave",
  hairline: "natural",
  product: "standard",
  attachment: "tape",
};

/** Words of the history that must never leave our database. */
const SKIN = "Dry at the crown, allergic to latex";
const HISTORY = { remedies: ["minoxidil", "transplant"], transplant_year: 2019, skin_and_allergies: SKIN };

const FIT_AS_READ = { ...FIT, product_name: "First fit" };

let logs: ReturnType<typeof captureLogs>;

beforeEach(async () => {
  logs = captureLogs();
  await markDatabase();
});

/** Today's consultation, checked in and started, its before photographs sent. */
async function consultation(): Promise<Working> {
  const job = await working("consultation");
  await job.workTo("checklist");
  return job;
}

const card = async (job: Working) => (await job.get(`/api/tech/jobs/${JOB}`)).json<Record<string, unknown>>();

const versions = () =>
  env.DB.prepare(
    `SELECT appointment_id, event_id, technician_id, staff, colour, remedies, skin_and_allergies FROM hair_profiles
     ORDER BY created_at, rowid`,
  ).all();

const consentRows = () =>
  env.DB.prepare("SELECT COUNT(*) AS n FROM consents WHERE person_id = ?1").bind(PERSON).first();

describe("the technician's profile step", () => {
  it("comes before the after photographs at a consultation, and the card offers the products", async () => {
    const job = await working("consultation");
    expect(await card(job)).toMatchObject({
      steps: ["before_photos", "checklist", "consumables", "profile", "after_photos", "outcome"],
      products: [{ tier: "standard", name: "First fit" }],
      profile: null,
    });
  });

  it("is not a step of a service visit, and its card still carries the latest profile", async () => {
    const job = await consultation();
    await job.post(PROFILE, { fit: FIT, history: null }, "event-profile-01");
    await env.DB.prepare("UPDATE appointments SET type = 'service' WHERE id = ?1").bind(JOB).run();
    const serviceCard = await card(job);
    expect(serviceCard.steps).not.toContain("profile");
    expect(serviceCard).toMatchObject({ products: [], profile: { fit: FIT_AS_READ, history: null } });
  });

  it("records the fit spec and the history as a version keyed to the visit, which the card then reads", async () => {
    const job = await consultation();
    const consentsBefore = await consentRows();
    const answer = await job.post(PROFILE, { fit: FIT, history: HISTORY }, "event-profile-01");

    expect(answer.status).toBe(202);
    expect(await answer.json()).toMatchObject({ event_id: "event-profile-01", replayed: false });
    expect((await versions()).results).toEqual([
      {
        appointment_id: JOB,
        event_id: "event-profile-01",
        technician_id: IMRAN,
        staff: null,
        colour: "1B",
        remedies: '["minoxidil","transplant"]',
        skin_and_allergies: SKIN,
      },
    ]);
    expect(await card(job)).toMatchObject({
      progress: { steps_done: ["before_photos", "profile"] },
      profile: { recorded_at: NOW.toISOString(), fit: FIT_AS_READ, history: HISTORY },
    });
    // The owner ruled it needs no consent of its own: none is asked for, and none written.
    expect(await consentRows()).toEqual(consentsBefore);
  });

  it("records a replay once, and answers it as the first", async () => {
    const job = await consultation();
    await job.post(PROFILE, { fit: FIT, history: HISTORY }, "event-profile-01");
    const replay = await job.post(PROFILE, { fit: { ...FIT, colour: "2" }, history: null }, "event-profile-01");

    expect(await replay.json()).toMatchObject({ event_id: "event-profile-01", replayed: true });
    expect((await versions()).results).toHaveLength(1);
  });

  it("keeps each change as a new version, the latest being the profile", async () => {
    const job = await consultation();
    await job.post(PROFILE, { fit: FIT, history: HISTORY }, "event-profile-01");
    await job.post(PROFILE, { fit: { ...FIT, colour: "2", grey_percent: 30 }, history: null }, "event-profile-02");

    expect((await versions()).results.map((row) => row.colour)).toEqual(["1B", "2"]);
    expect(await card(job)).toMatchObject({ profile: { fit: { colour: "2", grey_percent: 30 }, history: null } });
  });

  it("takes the fit spec unanswered, field by field", async () => {
    const job = await consultation();
    const blank = Object.fromEntries(Object.keys(FIT).map((field) => [field, null]));
    expect((await job.post(PROFILE, { fit: blank, history: null }, "event-profile-01")).status).toBe(202);
  });

  it("is refused before the job is started, as any step is", async () => {
    const job = await working("consultation");
    const answer = await job.post(PROFILE, { fit: FIT, history: null }, "event-profile-01");
    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "out_of_order", fields: ["start"] } });
  });

  it("is refused for a job ops gave to another technician, and keeps nothing of it", async () => {
    const job = await consultation();
    await env.DB.prepare("UPDATE appointments SET technician_id = ?2 WHERE id = ?1").bind(JOB, SAMEER).run();
    const answer = await job.post(PROFILE, { fit: FIT, history: HISTORY }, "event-profile-01");

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "superseded", fields: ["technician"] } });
    expect((await versions()).results).toEqual([]);
  });

  it.each([
    [
      "a measurement past its range",
      { fit: { ...FIT, head_circumference_cm: 90 }, history: null },
      "fit.head_circumference_cm",
    ],
    ["a measurement to two decimals", { fit: { ...FIT, base_width_in: 8.25 }, history: null }, "fit.base_width_in"],
    ["a colour not on the list", { fit: { ...FIT, colour: "9Z" }, history: null }, "fit.colour"],
    ["a density not on the list", { fit: { ...FIT, density_percent: 110 }, history: null }, "fit.density_percent"],
    ["a product that is no first fit", { fit: { ...FIT, product: "nonesuch" }, history: null }, "fit.product"],
    [
      '"none" beside a remedy',
      { fit: FIT, history: { ...HISTORY, remedies: ["none", "minoxidil"], transplant_year: null } },
      "history.remedies",
    ],
    [
      "a transplant's year to come",
      { fit: FIT, history: { ...HISTORY, transplant_year: 2027 } },
      "history.transplant_year",
    ],
  ])("refuses %s, naming the field", async (_, body, field) => {
    const job = await consultation();
    const answer = await job.post(PROFILE, body, "event-profile-01");
    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({ error: { code: "invalid_request", fields: [field] } });
    expect((await versions()).results).toEqual([]);
  });

  it("is a step of a one visit too, once the product is chosen and fitted", async () => {
    const job = await working("first_fit");
    await env.DB.prepare("UPDATE appointments SET one_visit = 'booked' WHERE id = ?1").bind(JOB).run();
    expect((await card(job)).steps).toEqual([
      "before_photos",
      "checklist",
      "consumables",
      "piece",
      "profile",
      "after_photos",
      "outcome",
    ]);
  });

  it("withholds the profile from a card still locked, as it does the client", async () => {
    const job = await consultation();
    await job.post(PROFILE, { fit: FIT, history: HISTORY }, "event-profile-01");
    await env.DB.prepare("UPDATE appointments SET window_start = '2026-09-25T07:30:00.000Z' WHERE id = ?1")
      .bind(JOB)
      .run();
    expect(await card(job)).toMatchObject({ client: null, profile: null });
  });
});

describe("what never leaves our database", () => {
  it("puts nothing on FSM's queue, and FSM's summary of the visit carries none of it", async () => {
    const job = await consultation();
    const queued = job.fsmQueue.sent.length;
    await job.post(PROFILE, { fit: FIT, history: HISTORY }, "event-profile-01");

    expect(job.fsmQueue.sent).toHaveLength(queued);
    const visit = { id: JOB, fsmId: "ap-today", type: "consultation" as const, oneVisit: false, personId: PERSON };
    const summary = await summaryOf(env.DB, { ...visit, fsmContactId: "contact-1" }, { labelAsTest: false });
    for (const word of [SKIN, "minoxidil", "1B", "57.5"]) expect(summary).not.toContain(word);
  });

  it("writes none of it to a log line, from the phone or the console", async () => {
    const job = await consultation();
    await job.post(PROFILE, { fit: FIT, history: HISTORY }, "event-profile-01");
    await job.opsPost(CONSOLE, {
      fit: { ...FIT, colour: "2" },
      history: { ...HISTORY, skin_and_allergies: "Psoriasis" },
    });

    const written = JSON.stringify(logs.lines());
    for (const word of [SKIN, "Psoriasis", "minoxidil"]) expect(written).not.toContain(word);
  });
});

describe("the client's page in the console", () => {
  async function recorded(): Promise<Working> {
    const job = await consultation();
    await job.post(PROFILE, { fit: FIT, history: HISTORY }, "event-profile-01");
    return job;
  }

  const read = async (job: Working) => (await request(job.ops, CONSOLE)).json<Record<string, unknown>>();

  it("shows the latest profile and every version, with who recorded each and at which visit", async () => {
    const job = await recorded();
    expect(await read(job)).toEqual({
      latest: { recorded_at: NOW.toISOString(), fit: FIT_AS_READ, history: HISTORY },
      versions: [
        {
          id: expect.any(String) as unknown,
          recorded_at: NOW.toISOString(),
          recorded_by: { kind: "technician", name: "Imran" },
          visit: { id: JOB, date: "2026-09-21", type: "consultation" },
          fit: FIT_AS_READ,
          history: HISTORY,
        },
      ],
      // What a correction may name: every first-fit service, by its tier and name.
      products: [{ tier: "standard", name: "First fit" }],
    });
  });

  it("records a correction as a new version under the member of staff, and audits it by its id alone", async () => {
    const job = await recorded();
    const answer = await job.opsPost(CONSOLE, {
      fit: { ...FIT, colour: "2" },
      history: { ...HISTORY, skin_and_allergies: "Psoriasis" },
    });

    expect(answer.status).toBe(200);
    const page = await answer.json<{ latest: unknown; versions: { recorded_by: unknown; visit: unknown }[] }>();
    expect(page.latest).toMatchObject({ fit: { colour: "2" }, history: { skin_and_allergies: "Psoriasis" } });
    expect(page.versions.map((version) => [version.recorded_by, version.visit])).toEqual([
      [{ kind: "ops", staff: "ops@localhost" }, null],
      [{ kind: "technician", name: "Imran" }, expect.objectContaining({ id: JOB })],
    ]);
    const audit = await env.DB.prepare(
      "SELECT actor, subject_kind, subject_id, detail FROM audit_log WHERE action = 'hair_profile.correct'",
    ).first<{ detail: string }>();
    expect(audit).toMatchObject({ actor: "ops@localhost", subject_kind: "person", subject_id: PERSON });
    const everyEntry = JSON.stringify((await env.DB.prepare("SELECT * FROM audit_log").all()).results);
    for (const word of ["Psoriasis", SKIN, "minoxidil"]) expect(everyEntry).not.toContain(word);
  });

  it("records a first profile where none was taken, its history with it", async () => {
    const job = await working("consultation");
    const answer = await job.opsPost(CONSOLE, { fit: FIT, history: HISTORY });
    expect(await answer.json()).toMatchObject({ latest: { fit: FIT_AS_READ, history: HISTORY }, versions: [{}] });
  });

  it("refuses a value off the lists, as the phone's is", async () => {
    const job = await working("consultation");
    const answer = await job.opsPost(CONSOLE, { fit: { ...FIT, wave: "frizzy" }, history: null });
    expect(await answer.json()).toMatchObject({ error: { fields: ["fit.wave"] } });
  });

  it("knows no erased client, nor one never seen", async () => {
    const job = await recorded();
    await eraseByMobile("+919810000001");
    expect((await request(job.ops, CONSOLE)).status).toBe(404);
    expect((await job.opsPost(CONSOLE, { fit: FIT, history: null })).status).toBe(404);
  });
});

describe("the client's rights over it", () => {
  it("is blanked by an erasure, every version and every field of it, the record of who took each kept", async () => {
    const job = await consultation();
    await job.post(PROFILE, { fit: FIT, history: HISTORY }, "event-profile-01");
    await job.opsPost(CONSOLE, { fit: FIT, history: HISTORY });
    await eraseByMobile("+919810000001");

    const rows = await env.DB.prepare("SELECT * FROM hair_profiles ORDER BY created_at, rowid").all();
    expect(rows.results).toHaveLength(2);
    for (const row of rows.results) {
      const { id, person_id, appointment_id, event_id, technician_id, staff, created_at, ...profile } = row;
      expect([id, person_id, created_at]).not.toContain(null);
      expect([appointment_id, event_id, technician_id, staff].some((value) => value !== null)).toBe(true);
      expect(Object.values(profile).every((value) => value === null)).toBe(true);
    }
  });

  it("is in the export a client asks for, the history with it", async () => {
    const job = await consultation();
    await job.post(PROFILE, { fit: FIT, history: HISTORY }, "event-profile-01");
    const cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: PERSON, deviceLabel: null, now: NOW })}`;
    const client = appFor("local", fakeDependencies(), {}, "client");

    const exported = await (
      await request(client, "/api/me/export", { headers: { Cookie: cookie } })
    ).json<{
      hair_profile: Record<string, unknown>[];
    }>();
    expect(exported.hair_profile).toEqual([
      expect.objectContaining({ recorded_at: NOW.toISOString(), recorded_by: "technician", colour: "1B", ...HISTORY }),
    ]);
  });
});
