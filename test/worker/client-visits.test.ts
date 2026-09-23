// The client app's visits and photographs, read from the FSM mirror. The
// mirror is filled the way staging fills it: syncAppointment and
// exportVisitPhotos over a stub FSM. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.ts";
import { syncAppointment } from "../../src/domain/fsm-mirror.ts";
import { findEligiblePerson } from "../../src/domain/login.ts";
import { openSession } from "../../src/domain/sessions.ts";
import { exportVisitPhotos } from "../../src/domain/visit-photos.ts";
import { createStubFsm, type FsmAppointment, type StubFsmWorld } from "../../src/providers/fsm.ts";
import { appFor, fakeDependencies, markDatabase, NOW, request } from "./helpers.ts";
import { syntheticJpeg } from "./tryon-fixtures.ts";

const MOBILE = "+919810000001";

const fsmAppointment = (id: string, overrides: Partial<FsmAppointment> = {}): FsmAppointment => ({
  id,
  name: id.toUpperCase(),
  status: "Scheduled",
  workOrderId: null,
  contactId: "contact-1",
  scheduledStart: "2026-09-24T10:00:00+05:30",
  scheduledEnd: "2026-09-24T11:30:00+05:30",
  actualStart: null,
  actualEnd: null,
  technicianIds: ["sr-1"],
  serviceIds: ["item-service"],
  serviceCity: "Gurgaon",
  servicePincode: "122018",
  modifiedAt: "2026-09-20T10:00:00+05:30",
  ...overrides,
});

function world(appointments: FsmAppointment[]): StubFsmWorld {
  return {
    appointments,
    contacts: [
      { id: "contact-1", name: "Rohit Malhotra", mobile: MOBILE, email: null },
      { id: "contact-2", name: "Someone Else", mobile: "+919810000002", email: null },
    ],
    technicians: [{ id: "sr-1", userId: "user-1", name: "Imran Khan", active: true, mobile: null, zone: null }],
    items: [
      { id: "item-service", name: "Service visit", type: "Service" },
      { id: "item-consult", name: "Consultation", type: "Service" },
    ],
    attachments: {
      "ap-done": [
        { id: "a1", fileId: "f1", name: "before-front.jpg", size: 10, createdAt: "2026-09-10T10:05:00+05:30" },
        { id: "a2", fileId: "f2", name: "after-front.jpg", size: 10, createdAt: "2026-09-10T11:10:00+05:30" },
      ],
      "ap-earlier": [
        { id: "a3", fileId: "f3", name: "after-front.jpg", size: 10, createdAt: "2026-08-01T11:10:00+05:30" },
      ],
    },
    files: {
      f1: { bytes: syntheticJpeg(1200, 1600), contentType: "image/jpeg" },
      f2: { bytes: syntheticJpeg(1200, 1600), contentType: "image/jpeg" },
      f3: { bytes: syntheticJpeg(800, 1000), contentType: "image/jpeg" },
    },
  };
}

const done = (id: string, date: string, overrides: Partial<FsmAppointment> = {}) =>
  fsmAppointment(id, {
    status: "Completed",
    scheduledStart: `${date}T10:00:00+05:30`,
    scheduledEnd: `${date}T11:30:00+05:30`,
    actualStart: `${date}T10:05:00+05:30`,
    actualEnd: `${date}T11:15:00+05:30`,
    ...overrides,
  });

/** Mirrors these appointments, exports their photographs, and returns our IDs by FSM ID. */
async function mirror(appointments: FsmAppointment[]): Promise<Record<string, string>> {
  const fsm = createStubFsm(world(appointments));
  const ids: Record<string, string> = {};
  for (const appointment of appointments) {
    const result = await syncAppointment(env.DB, fsm, appointment.id, NOW);
    ids[appointment.id] = result.appointmentId ?? "";
    if (result.status === "completed") {
      await exportVisitPhotos(
        env.DB,
        env.CLIENT_PHOTOS,
        fsm,
        { id: ids[appointment.id] ?? "", fsmId: appointment.id },
        NOW,
      );
    }
  }
  return ids;
}

let client: App;
let cookie: string;

async function signIn(): Promise<void> {
  const person = await env.DB.prepare("SELECT id FROM people WHERE mobile_e164 = ?1")
    .bind(MOBILE)
    .first<{ id: string }>();
  cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: person?.id ?? "", deviceLabel: null, now: NOW })}`;
}

const get = (path: string, withCookie = true) =>
  request(client, path, { headers: withCookie ? { Cookie: cookie } : {} });

beforeEach(async () => {
  client = appFor("local", fakeDependencies(), {}, "client");
  await markDatabase();
});

describe("GET /api/me, from the mirror", () => {
  it("is a lead with a consultation booked in FSM as the next visit", async () => {
    await mirror([fsmAppointment("ap-consult", { serviceIds: ["item-consult"] })]);
    await signIn();
    const me = await (await get("/api/me")).json<Record<string, unknown>>();
    expect(me).toMatchObject({
      state: "lead",
      consultation: null,
      next_visit: {
        date: "2026-09-24",
        window_label: "morning",
        starts_at: "2026-09-24T04:30:00.000Z",
        length_minutes: 90,
        type: "consultation",
        status: "scheduled",
        technician: { name: "Imran Khan", initials: "IK" },
        place: "Gurgaon 122018",
      },
      credits: null,
      prompt: null,
    });
  });

  it("is fitted once a visit after the consultation is done, with the next one ahead", async () => {
    await mirror([done("ap-done", "2026-09-10"), fsmAppointment("ap-next")]);
    await signIn();
    const me = await (await get("/api/me")).json<Record<string, unknown>>();
    expect(me).toMatchObject({ state: "fitted", next_visit: { type: "service", date: "2026-09-24" } });
  });

  it("drops a Phase 1 booking's proposal once FSM has a visit for the person, and offers the first fit", async () => {
    await env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name) VALUES ('p1', ?1, ?2, 'Rohit Malhotra')",
    )
      .bind(NOW.toISOString(), MOBILE)
      .run();
    await env.DB.prepare(
      `INSERT INTO leads (id, person_id, created_at, source, city, first_choice_window, loss_extent, proposed_visit_date,
         sync_state, request_id)
       VALUES ('l1', 'p1', ?1, 'form', 'Gurgaon', 'weekday_am', 'crown', '2026-09-10', 'synced', 'r1')`,
    )
      .bind(NOW.toISOString())
      .run();
    await mirror(
      [done("ap-done", "2026-09-10")].map((appointment) => ({ ...appointment, serviceIds: ["item-consult"] })),
    );
    await signIn();
    const me = await (await get("/api/me")).json<Record<string, unknown>>();
    expect(me).toMatchObject({
      state: "lead",
      consultation: null,
      next_visit: null,
      booking: { self_serve: true, types: ["first_fit"] },
    });
  });

  it("lets a client ops added only in FSM log in", async () => {
    await mirror([fsmAppointment("ap-next")]);
    expect(await findEligiblePerson(env.DB, MOBILE)).not.toBeNull();
    expect(await findEligiblePerson(env.DB, "+919810000009")).toBeNull();
  });
});

describe("GET /api/visits", () => {
  it("lists upcoming visits soonest first and past ones newest first, and only the client's own", async () => {
    await mirror([
      done("ap-earlier", "2026-08-01"),
      done("ap-done", "2026-09-10"),
      fsmAppointment("ap-next"),
      fsmAppointment("ap-someone-else", { contactId: "contact-2" }),
      fsmAppointment("ap-cancelled", { status: "Cancelled" }),
    ]);
    await signIn();
    const visits = await (await get("/api/visits")).json<{ upcoming: { date: string }[]; past: { date: string }[] }>();
    expect(visits.upcoming.map((visit) => visit.date)).toEqual(["2026-09-24"]);
    expect(visits.past.map((visit) => visit.date)).toEqual(["2026-09-10", "2026-08-01"]);
  });

  it("needs a session", async () => {
    expect((await get("/api/visits", false)).status).toBe(401);
  });
});

describe("GET /api/visits/:id and the photographs", () => {
  it("gives a done visit's duration, outcome and photographs, whose links open only for the client", async () => {
    const ids = await mirror([done("ap-done", "2026-09-10")]);
    await signIn();
    const visit = await (
      await get(`/api/visits/${ids["ap-done"] ?? ""}`)
    ).json<{
      duration_minutes: number;
      outcome: string;
      photos: { before: { angle: string; url: string }[]; after: { angle: string; url: string }[] };
    }>();
    expect(visit).toMatchObject({ duration_minutes: 70, outcome: "done", what_was_done: null });
    expect(visit.photos.before.map((photo) => photo.angle)).toEqual(["front"]);

    const url = visit.photos.after[0]?.url ?? "";
    const image = await get(url);
    expect(image.status).toBe(200);
    expect(image.headers.get("Content-Type")).toBe("image/jpeg");
    expect(new Uint8Array(await image.arrayBuffer()).slice(0, 3)).toEqual(new Uint8Array([0xff, 0xd8, 0xff]));
    expect((await get(url, false)).status).toBe(401);
  });

  it("does not show another client's visit or photograph", async () => {
    const ids = await mirror([done("ap-done", "2026-09-10")]);
    await signIn();
    const url =
      (await (await get(`/api/visits/${ids["ap-done"] ?? ""}`)).json<{ photos: { after: { url: string }[] } }>()).photos
        .after[0]?.url ?? "";

    const other = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000005', 'Other')",
    )
      .bind(other, NOW.toISOString())
      .run();
    cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: other, deviceLabel: null, now: NOW })}`;
    expect((await get(`/api/visits/${ids["ap-done"] ?? ""}`)).status).toBe(404);
    expect((await get(url)).status).toBe(404);
  });

  /*
   * The app tells three states apart from these two fields (ADR 0056): the invoice is
   * here, it is still to come, or the visit is free and none will ever exist. The app
   * must never have to guess the third from a price it happens to be showing.
   */
  it("says the invoice is still to come for a billed visit, and never coming for a free one", async () => {
    const ids = await mirror([
      done("ap-done", "2026-09-10"),
      done("ap-consult", "2026-09-08", { serviceIds: ["item-consult"] }),
    ]);
    await signIn();
    const detail = async (fsmId: string) =>
      (await get(`/api/visits/${ids[fsmId] ?? ""}`)).json<{ document_id: string | null; invoice_expected: boolean }>();

    expect(await detail("ap-done")).toMatchObject({ document_id: null, invoice_expected: true });
    expect(await detail("ap-consult")).toMatchObject({ document_id: null, invoice_expected: false });

    // Once the pass has issued it, the same visit hands the app the document to open.
    await env.DB.prepare("UPDATE appointments SET fsm_invoice_id = 'stub-41', invoice_issued_at = ?1 WHERE id = ?2")
      .bind(NOW.toISOString(), ids["ap-done"] ?? "")
      .run();
    expect(await detail("ap-done")).toMatchObject({ document_id: ids["ap-done"], invoice_expected: true });
  });

  it("offers no document while the invoice Books holds is still a draft", async () => {
    const ids = await mirror([done("ap-done", "2026-09-10")]);
    await signIn();
    await env.DB.prepare("UPDATE appointments SET fsm_invoice_id = 'stub-41' WHERE id = ?1")
      .bind(ids["ap-done"] ?? "")
      .run();
    expect(await (await get(`/api/visits/${ids["ap-done"] ?? ""}`)).json()).toMatchObject({ document_id: null });
  });

  it("refuses a photograph link once its 15 minutes are up", async () => {
    const ids = await mirror([done("ap-done", "2026-09-10")]);
    await signIn();
    const url =
      (await (await get(`/api/visits/${ids["ap-done"] ?? ""}`)).json<{ photos: { after: { url: string }[] } }>()).photos
        .after[0]?.url ?? "";
    const later = appFor("local", fakeDependencies({ now: () => new Date(NOW.getTime() + 16 * 60_000) }), {}, "client");
    expect((await request(later, url, { headers: { Cookie: cookie } })).status).toBe(404);
  });
});

describe("GET /api/photos and /api/photos/compare", () => {
  it("lists the visits that have photographs, newest first, and compares one angle across two", async () => {
    const ids = await mirror([
      done("ap-earlier", "2026-08-01"),
      done("ap-done", "2026-09-10"),
      fsmAppointment("ap-next"),
    ]);
    await signIn();
    const timeline = await (await get("/api/photos")).json<{ visits: { date: string }[] }>();
    expect(timeline.visits.map((visit) => visit.date)).toEqual(["2026-09-10", "2026-08-01"]);

    const compared = await (
      await get(`/api/photos/compare?from=${ids["ap-earlier"] ?? ""}&to=${ids["ap-done"] ?? ""}&angle=front`)
    ).json<{
      phase: string;
      from: { date: string; photo: { width: number } };
      to: { date: string; photo: { width: number } };
    }>();
    expect(compared).toMatchObject({
      phase: "after",
      from: { date: "2026-08-01", photo: { width: 800 } },
      to: { date: "2026-09-10", photo: { width: 1200 } },
    });
  });

  it("will not compare a visit that is not the client's", async () => {
    const ids = await mirror([done("ap-done", "2026-09-10")]);
    await signIn();
    const response = await get(
      `/api/photos/compare?from=${crypto.randomUUID()}&to=${ids["ap-done"] ?? ""}&angle=front`,
    );
    expect(response.status).toBe(404);
  });
});
