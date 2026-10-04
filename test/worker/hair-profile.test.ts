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

/** The client's latest version's ID, as a card or the client's page read it; null before one. */
const latestId = async () =>
  (
    await env.DB.prepare(
      "SELECT id FROM hair_profiles WHERE person_id = ?1 ORDER BY created_at DESC, rowid DESC LIMIT 1",
    )
      .bind(PERSON)
      .first<{ id: string }>()
  )?.id ?? null;

/** A write's body: the profile as it now stands, and the version its form started from, none unless named. */
const fromPhone = (fit: object, history: object | null, basedOn: string | null = null) => ({
  fit,
  history,
  based_on: basedOn,
});

/** Ops' correction, from the latest version as the page last read it. */
const fromOps = async (fit: object, history: object | null) => fromPhone(fit, history, await latestId());

describe("the technician's profile step", () => {
  it("comes before the outcome at a consultation, which takes no after photographs, and the card offers the products", async () => {
    const job = await working("consultation");
    expect(await card(job)).toMatchObject({
      steps: ["before_photos", "checklist", "consumables", "profile", "outcome"],
      products: [{ tier: "standard", name: "First fit" }],
      profile: null,
    });
  });

  it("is not a step of a service visit, and its card still carries the latest profile", async () => {
    const job = await consultation();
    await job.post(PROFILE, fromPhone(FIT, null), "event-profile-01");
    await env.DB.prepare("UPDATE appointments SET type = 'service' WHERE id = ?1").bind(JOB).run();
    const serviceCard = await card(job);
    expect(serviceCard.steps).not.toContain("profile");
    expect(serviceCard).toMatchObject({ products: [], profile: { fit: FIT_AS_READ, history: null } });
  });

  it("records the fit spec and the history as a version keyed to the visit, which the card then reads", async () => {
    const job = await consultation();
    const consentsBefore = await consentRows();
    const answer = await job.post(PROFILE, fromPhone(FIT, HISTORY), "event-profile-01");

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
    await job.post(PROFILE, fromPhone(FIT, HISTORY), "event-profile-01");
    const replay = await job.post(PROFILE, fromPhone({ ...FIT, colour: "2" }, null), "event-profile-01");

    expect(await replay.json()).toMatchObject({ event_id: "event-profile-01", replayed: true });
    expect((await versions()).results).toHaveLength(1);
  });

  it("keeps each change as a new version, the latest being the profile", async () => {
    const job = await consultation();
    await job.post(PROFILE, fromPhone(FIT, HISTORY), "event-profile-01");
    const second = fromPhone({ ...FIT, colour: "2", grey_percent: 30 }, null, await latestId());
    await job.post(PROFILE, second, "event-profile-02");

    expect((await versions()).results.map((row) => row.colour)).toEqual(["1B", "2"]);
    expect(await card(job)).toMatchObject({ profile: { fit: { colour: "2", grey_percent: 30 }, history: null } });
  });

  it("takes the fit spec unanswered, field by field", async () => {
    const job = await consultation();
    const blank = Object.fromEntries(Object.keys(FIT).map((field) => [field, null]));
    expect((await job.post(PROFILE, fromPhone(blank, null), "event-profile-01")).status).toBe(202);
  });

  it("is refused before the job is started, as any step is", async () => {
    const job = await working("consultation");
    const answer = await job.post(PROFILE, fromPhone(FIT, null), "event-profile-01");
    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "out_of_order", fields: ["start"] } });
  });

  it("is refused for a job ops gave to another technician, and keeps nothing of it", async () => {
    const job = await consultation();
    await env.DB.prepare("UPDATE appointments SET technician_id = ?2 WHERE id = ?1").bind(JOB, SAMEER).run();
    const answer = await job.post(PROFILE, fromPhone(FIT, HISTORY), "event-profile-01");

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "superseded", fields: ["technician"] } });
    expect((await versions()).results).toEqual([]);
  });

  it("is not found on a job that was never this technician's, and keeps nothing of it", async () => {
    const job = await working("consultation");
    await env.DB.prepare("UPDATE appointments SET technician_id = ?2 WHERE id = ?1").bind(JOB, SAMEER).run();

    const answer = await job.post(PROFILE, fromPhone(FIT, HISTORY), "event-profile-01");

    expect(answer.status).toBe(404);
    expect(await answer.json()).not.toHaveProperty("progress");
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
    const answer = await job.post(PROFILE, { ...body, based_on: null }, "event-profile-01");
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
    await job.post(PROFILE, fromPhone(FIT, HISTORY), "event-profile-01");
    await env.DB.prepare("UPDATE appointments SET window_start = '2026-09-25T07:30:00.000Z' WHERE id = ?1")
      .bind(JOB)
      .run();
    expect(await card(job)).toMatchObject({ client: null, profile: null });
  });

  it("is no step of a job with no client of ours, and a write for one stops nothing behind it", async () => {
    const job = await consultation();
    await env.DB.prepare("UPDATE appointments SET person_id = NULL WHERE id = ?1").bind(JOB).run();
    expect((await card(job)).steps).not.toContain("profile");

    // A phone that queued it before the client was unlinked: answered as taken, so its outcome follows.
    const answer = await job.post(PROFILE, fromPhone(FIT, HISTORY), "event-profile-01");
    expect(answer.status).toBe(202);
    expect((await versions()).results).toEqual([]);
    await job.post(`/api/tech/jobs/${JOB}/checklist`, { done: [] }, "event-checklist-01");
    await job.post(`/api/tech/jobs/${JOB}/consumables`, { items: [] }, "event-consumables-01");
    const outcome = await job.post(`/api/tech/jobs/${JOB}/outcome`, { outcome: "done" }, "event-outcome-01");
    expect(outcome.status).toBe(202);
  });

  it("is refused on a visit that takes no profile, as the piece is on one that takes no piece", async () => {
    const job = await working("service");
    await job.workTo("checklist");
    const answer = await job.post(PROFILE, fromPhone(FIT, null), "event-profile-01");
    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({ error: { code: "invalid_request", fields: ["visit"] } });
    expect((await versions()).results).toEqual([]);
  });
});

// Offline at 13:20 the phone holds version A; ops correct it to B at 13:40; the phone sends at 15:00. The phone's
// write lands, since the technician measured the client in person, and ops are told; ops' own correction is refused
// once another version has become the latest, so neither ever replaces a newer one silently.
describe("a profile written from an older copy", () => {
  it("from the phone, lands as the latest, and ops are told by the client's ID alone", async () => {
    const job = await consultation();
    await job.post(PROFILE, fromPhone(FIT, HISTORY), "event-profile-01");
    const heldByThePhone = await latestId();
    await job.opsPost(CONSOLE, await fromOps({ ...FIT, colour: "2" }, HISTORY));

    const answer = await job.post(
      PROFILE,
      fromPhone({ ...FIT, colour: "3" }, HISTORY, heldByThePhone),
      "event-profile-02",
    );
    expect(answer.status).toBe(202);
    expect(await card(job)).toMatchObject({ profile: { fit: { colour: "3" } } });
    expect(job.deps.alerts).toHaveLength(1);
    expect(job.deps.alerts[0]).toContain(PERSON);
    for (const word of [SKIN, "minoxidil", "1B"]) expect(job.deps.alerts[0]).not.toContain(word);
  });

  it("from the phone, tells ops nothing when it was taken from the latest", async () => {
    const job = await consultation();
    await job.post(PROFILE, fromPhone(FIT, HISTORY), "event-profile-01");
    await job.post(PROFILE, fromPhone({ ...FIT, colour: "2" }, HISTORY, await latestId()), "event-profile-02");
    expect(job.deps.alerts).toEqual([]);
  });

  it("from the console, is refused, and writes and audits nothing", async () => {
    const job = await consultation();
    await job.post(PROFILE, fromPhone(FIT, HISTORY), "event-profile-01");
    const readByTheConsole = await latestId();
    await job.post(PROFILE, fromPhone({ ...FIT, colour: "2" }, HISTORY, readByTheConsole), "event-profile-02");

    const answer = await job.opsPost(CONSOLE, fromPhone({ ...FIT, colour: "4" }, HISTORY, readByTheConsole));
    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "superseded" } });
    expect((await versions()).results.map((row) => row.colour)).toEqual(["1B", "2"]);
    const audited = await env.DB.prepare("SELECT 1 FROM audit_log WHERE action = 'hair_profile.correct'").first();
    expect(audited).toBeNull();
  });

  it("from the console, as a first profile, is refused once the technician has recorded one", async () => {
    const job = await consultation();
    await job.post(PROFILE, fromPhone(FIT, HISTORY), "event-profile-01");
    expect((await job.opsPost(CONSOLE, fromPhone(FIT, null, null))).status).toBe(409);
  });
});

describe("what never leaves our database", () => {
  it("puts nothing on FSM's queue, and FSM's summary of the visit carries none of it", async () => {
    const job = await consultation();
    const queued = job.fsmQueue.sent.length;
    await job.post(PROFILE, fromPhone(FIT, HISTORY), "event-profile-01");

    expect(job.fsmQueue.sent).toHaveLength(queued);
    const visit = { id: JOB, fsmId: "ap-today", type: "consultation" as const, oneVisit: false, personId: PERSON };
    const summary = await summaryOf(env.DB, { ...visit, fsmContactId: "contact-1" }, { labelAsTest: false });
    for (const word of [SKIN, "minoxidil", "1B", "57.5"]) expect(summary).not.toContain(word);
  });

  it("writes none of it to a log line, from the phone or the console", async () => {
    const job = await consultation();
    await job.post(PROFILE, fromPhone(FIT, HISTORY), "event-profile-01");
    await job.opsPost(CONSOLE, await fromOps({ ...FIT, colour: "2" }, { ...HISTORY, skin_and_allergies: "Psoriasis" }));

    const written = JSON.stringify(logs.lines());
    for (const word of [SKIN, "Psoriasis", "minoxidil"]) expect(written).not.toContain(word);
  });
});

describe("the client's page in the console", () => {
  async function recorded(): Promise<Working> {
    const job = await consultation();
    await job.post(PROFILE, fromPhone(FIT, HISTORY), "event-profile-01");
    return job;
  }

  const read = async (job: Working) => (await request(job.ops, CONSOLE)).json<Record<string, unknown>>();

  it("shows the latest profile and every version, with who recorded each and at which visit", async () => {
    const job = await recorded();
    const id = await latestId();
    expect(await read(job)).toEqual({
      latest: { id, recorded_at: NOW.toISOString(), fit: FIT_AS_READ, history: HISTORY },
      versions: [
        {
          id,
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
    const answer = await job.opsPost(
      CONSOLE,
      await fromOps({ ...FIT, colour: "2" }, { ...HISTORY, skin_and_allergies: "Psoriasis" }),
    );

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
    const answer = await job.opsPost(CONSOLE, await fromOps(FIT, HISTORY));
    expect(await answer.json()).toMatchObject({ latest: { fit: FIT_AS_READ, history: HISTORY }, versions: [{}] });
  });

  it("refuses a value off the lists, as the phone's is", async () => {
    const job = await working("consultation");
    const answer = await job.opsPost(CONSOLE, await fromOps({ ...FIT, wave: "frizzy" }, null));
    expect(await answer.json()).toMatchObject({ error: { fields: ["fit.wave"] } });
  });

  it("knows no erased client, nor one never seen", async () => {
    const job = await recorded();
    await eraseByMobile("+919810000001");
    expect((await request(job.ops, CONSOLE)).status).toBe(404);
    expect((await job.opsPost(CONSOLE, fromPhone(FIT, null))).status).toBe(404);
  });
});

describe("the client's rights over it", () => {
  it("is blanked by an erasure, every version and every field of it, the record of who took each kept", async () => {
    const job = await consultation();
    await job.post(PROFILE, fromPhone(FIT, HISTORY), "event-profile-01");
    await job.opsPost(CONSOLE, await fromOps(FIT, HISTORY));
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
    await job.post(PROFILE, fromPhone(FIT, HISTORY), "event-profile-01");
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
