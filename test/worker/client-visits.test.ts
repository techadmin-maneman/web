// The client app's visits and photographs, read from the FSM mirror. The
// mirror is filled the way staging fills it: syncAppointment and
// exportVisitPhotos over a stub FSM. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/http/context.ts";
import { syncAppointment } from "../../src/domain/fsm-mirror.ts";
import { findEligiblePerson } from "../../src/domain/login.ts";
import { openSession } from "../../src/domain/sessions.ts";
import { RULES } from "../../src/policy/home-prompt.ts";
import { exportVisitPhotos } from "../../src/domain/visit-photos.ts";
import { createStubFsm, type FsmAppointment, type StubFsmWorld } from "../../src/providers/fsm.ts";
import { appFor, d1TripsOf, fakeDependencies, markDatabase, NOW, phaseOneLead, request } from "./helpers.ts";
import { syntheticJpeg } from "./tryon-fixtures.ts";

const MOBILE = "+919810000001";
/** The most round trips to D1 Home may wait on in turn. It waited on 17 when each read waited for the one before. */
const ME_TRIPS = 6;

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
      { id: "item-service", name: "Service visit", type: "Service", price: null },
      { id: "item-consult", name: "Consultation", type: "Service", price: null },
      { id: "item-replacement", name: "Replacement", type: "Service", price: null },
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
      // Booked, and no address given yet: the technician has no door to go to.
      prompt: { kind: "address" },
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
    const visits = await (
      await get("/api/visits")
    ).json<{ upcoming: { date: string }[]; past: { date: string; status: string }[] }>();
    expect(visits.upcoming.map((visit) => visit.date)).toEqual(["2026-09-24"]);
    // A cancelled visit stays on the list, under past, so the client keeps a record of it.
    expect(visits.past.map(({ date, status }) => ({ date, status }))).toEqual([
      { date: "2026-09-24", status: "cancelled" },
      { date: "2026-09-10", status: "completed" },
      { date: "2026-08-01", status: "completed" },
    ]);
  });

  it("leaves out a visit a charged move replaced, since the new visit stands in its place", async () => {
    const ids = await mirror([
      fsmAppointment("ap-replaced", { status: "Cancelled" }),
      fsmAppointment("ap-cancelled", { status: "Cancelled", scheduledStart: "2026-09-23T10:00:00+05:30" }),
    ]);
    const replaced = await env.DB.prepare("SELECT person_id, window_start FROM appointments WHERE id = ?1")
      .bind(ids["ap-replaced"])
      .first<{ person_id: string; window_start: string }>();
    await env.DB.prepare(
      `INSERT INTO visit_changes (id, appointment_id, person_id, kind, notice, was_start, created_at)
       VALUES ('change-1', ?1, ?2, 'replaced', 'late', ?3, ?4)`,
    )
      .bind(ids["ap-replaced"], replaced?.person_id, replaced?.window_start, NOW.toISOString())
      .run();
    await signIn();
    const visits = await (await get("/api/visits")).json<{ past: { date: string }[] }>();
    expect(visits.past.map((visit) => visit.date)).toEqual(["2026-09-23"]);
  });

  it("needs a session", async () => {
    expect((await get("/api/visits", false)).status).toBe(401);
  });
});

describe("a visit booked without FSM", () => {
  // Our own ID stands in its FSM ID, and it has no work order, FSM status or time FSM changed it.
  async function bookedWithoutFsm(): Promise<void> {
    const at = NOW.toISOString();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO people (id, created_at, mobile_e164, name) VALUES ('p1', ?1, ?2, 'Rohit Malhotra')",
      ).bind(at, MOBILE),
      env.DB.prepare(
        `INSERT INTO technicians (id, fsm_id, name, initials, active, hand_written, updated_at)
         VALUES ('t1', 't1', 'Imran Khan', 'IK', 1, 1, ?1)`,
      ).bind(at),
      env.DB.prepare(
        `INSERT INTO appointments (id, fsm_id, fsm_work_order_id, person_id, type, window_start, window_end,
           technician_id, status, fsm_status, service_city, service_pincode, fsm_modified_at, synced_at, first_seen_at)
         VALUES ('ap-ours', 'ap-ours', NULL, 'p1', 'service', '2026-09-24T04:30:00.000Z', '2026-09-24T06:00:00.000Z',
           't1', 'scheduled', NULL, 'Gurgaon', '122018', NULL, ?1, ?1)`,
      ).bind(at),
    ]);
  }

  it("is the client's next visit, like one FSM holds", async () => {
    await bookedWithoutFsm();
    await signIn();
    const visits = await (await get("/api/visits")).json<{ upcoming: Record<string, unknown>[] }>();
    expect(visits.upcoming).toMatchObject([
      { date: "2026-09-24", type: "service", status: "scheduled", technician: { name: "Imran Khan", initials: "IK" } },
    ]);
    const me = await (await get("/api/me")).json<Record<string, unknown>>();
    expect(me).toMatchObject({ next_visit: { date: "2026-09-24", type: "service", stage: "booked" } });
  });

  // MON-10: Home and Visits never said which hair system a first fit was for.
  it("names the hair system a first fit was sold as, and nothing for a kind's standard service", async () => {
    await bookedWithoutFsm();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO services (kind, tier, name, minutes, sort, updated_by, updated_at)
         VALUES ('first_fit', 'essential', 'Mane Man Essential', 180, 1, 'ops@localhost', ?1)`,
      ).bind(NOW.toISOString()),
      env.DB.prepare("UPDATE appointments SET type = 'first_fit', tier = 'essential' WHERE id = 'ap-ours'"),
    ]);
    await signIn();
    const visits = await (await get("/api/visits")).json<{ upcoming: Record<string, unknown>[] }>();
    expect(visits.upcoming).toMatchObject([{ type: "first_fit", service: "Mane Man Essential" }]);
    const me = await (await get("/api/me")).json<Record<string, unknown>>();
    expect(me).toMatchObject({ next_visit: { service: "Mane Man Essential" } });

    // Booked as one visit, the client has not chosen their hair system yet.
    await env.DB.prepare("UPDATE appointments SET one_visit = 'booked' WHERE id = 'ap-ours'").run();
    const oneVisit = await (await get("/api/visits")).json<{ upcoming: Record<string, unknown>[] }>();
    expect(oneVisit.upcoming).toMatchObject([{ service: null }]);

    await env.DB.prepare(
      "UPDATE appointments SET type = 'service', tier = 'standard', one_visit = NULL WHERE id = 'ap-ours'",
    ).run();
    const standard = await (await get("/api/visits")).json<{ upcoming: Record<string, unknown>[] }>();
    expect(standard.upcoming).toMatchObject([{ type: "service", service: null }]);
  });
});

// A visit stays the client's until FSM closes it. One that dropped out of both lists once its window
// ended left Home saying nothing was booked, and offering the booking again (LIFE-03).
describe("a visit FSM has not closed", () => {
  // NOW is 12:00 on Monday 21 September in India.
  const yesterday = fsmAppointment("ap-yesterday", {
    scheduledStart: "2026-09-20T10:00:00+05:30",
    scheduledEnd: "2026-09-20T11:30:00+05:30",
  });
  const now = fsmAppointment("ap-now", {
    status: "In Progress",
    scheduledStart: "2026-09-21T11:00:00+05:30",
    scheduledEnd: "2026-09-21T12:30:00+05:30",
  });

  it("stays under upcoming once its window has passed, as being closed", async () => {
    await mirror([yesterday, fsmAppointment("ap-next")]);
    await signIn();
    const visits = await (await get("/api/visits")).json<{ upcoming: { date: string; stage: string }[] }>();
    expect(visits.upcoming.map(({ date, stage }) => ({ date, stage }))).toEqual([
      { date: "2026-09-20", stage: "closing" },
      { date: "2026-09-24", stage: "booked" },
    ]);
  });

  it("is in progress while the technician works in its window", async () => {
    await mirror([now]);
    await signIn();
    const visits = await (await get("/api/visits")).json<{ upcoming: { stage: string }[] }>();
    expect(visits.upcoming.map((visit) => visit.stage)).toEqual(["in_progress"]);
  });

  it("keeps Home on the visit, rather than saying nothing is booked", async () => {
    await mirror([yesterday]);
    await signIn();
    const me = await (await get("/api/me")).json<Record<string, unknown>>();
    expect(me).toMatchObject({ state: "lead", next_visit: { date: "2026-09-20", stage: "closing" } });
  });

  it("gives way on Home to a visit still to come", async () => {
    await mirror([yesterday, fsmAppointment("ap-next")]);
    await signIn();
    const me = await (await get("/api/me")).json<Record<string, unknown>>();
    expect(me).toMatchObject({ next_visit: { date: "2026-09-24", stage: "booked" } });
  });
});

// Board B1's one prompt, in the owner's order (src/policy/home-prompt.ts): an address to give while something is
// booked, then the next service due and not booked, then an invoice just issued, which is also a line of its own
// beneath whichever prompt leads, then a replacement falling due within reach (LIFE-08).
describe("GET /api/me's prompt and invoice line", () => {
  const personId = async () =>
    (await env.DB.prepare("SELECT id FROM people WHERE mobile_e164 = ?1").bind(MOBILE).first<{ id: string }>())?.id ??
    "";
  const giveAddress = async () =>
    env.DB.prepare(
      `INSERT INTO addresses (id, person_id, created_at, line1, locality, city, pincode)
       VALUES (?1, ?2, ?3, 'House 12', 'Sector 65', 'Gurgaon', '122018')`,
    )
      .bind(crypto.randomUUID(), await personId(), NOW.toISOString())
      .run();
  const fitPiece = async (due: string) =>
    env.DB.prepare(
      `INSERT INTO pieces (id, fsm_id, person_id, piece_code, fitted_at, replacement_due_at, synced_at)
       VALUES (?1, ?1, ?2, 'MM-STD-4417-B', '2026-09-10', ?3, ?4)`,
    )
      .bind(crypto.randomUUID(), await personId(), due, NOW.toISOString())
      .run();
  const issueInvoice = async (appointmentId: string, daysAgo: number) =>
    env.DB.prepare("UPDATE appointments SET fsm_invoice_id = 'stub-1', invoice_issued_at = ?1 WHERE id = ?2")
      .bind(new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString(), appointmentId)
      .run();
  const home = async () => (await get("/api/me")).json<{ prompt: unknown; invoice: unknown }>();
  const prompt = async () => (await home()).prompt;

  it("asks for an address first, where a visit is booked and none is given", async () => {
    await mirror([done("ap-done", "2026-09-10"), fsmAppointment("ap-next")]);
    await signIn();
    await fitPiece("2026-10-05");
    expect(await prompt()).toEqual({ kind: "address" });
  });

  it("then offers the next service, due a month after the last visit, in its window, while nothing is booked", async () => {
    await mirror([done("ap-done", "2026-09-10")]);
    await signIn();
    await giveAddress();
    await fitPiece("2027-03-09");
    expect(await prompt()).toEqual({
      kind: "next_visit",
      type: "service",
      tier: "standard",
      due_on: "2026-10-10",
      date: "2026-10-10",
      window: "morning",
      replacement_bookable: false,
    });
  });

  it("offers the replacement beside the next service only once the piece's month is within reach", async () => {
    await mirror([done("ap-done", "2026-09-10")]);
    await signIn();
    await giveAddress();
    // The service falls due on 10 October and the piece in November, inside the 45 days a visit may be booked ahead.
    await fitPiece("2026-11-03");
    expect(await prompt()).toMatchObject({ kind: "next_visit", type: "service", replacement_bookable: true });
  });

  it(RULES[2], async () => {
    await mirror([done("ap-done", "2026-09-10"), fsmAppointment("ap-next")]);
    await signIn();
    await giveAddress();
    // March is past the 45 days a visit may be booked ahead: nothing to say about it yet.
    await fitPiece("2027-03-09");
    expect(await home()).toMatchObject({ prompt: null, invoice: null });
  });

  it("offers to book the replacement once its month is within reach, and never while one is booked", async () => {
    await mirror([done("ap-done", "2026-09-10"), fsmAppointment("ap-next")]);
    await signIn();
    await giveAddress();
    await fitPiece("2026-10-05");
    // A service visit is booked, and October is within the 45 days a visit may be booked ahead.
    expect(await prompt()).toEqual({ kind: "replacement_due", month: "2026-10", tier: "standard" });

    // The replacement is booked: Home's card shows it, and the prompt no longer offers a second.
    await mirror([
      done("ap-done", "2026-09-10"),
      fsmAppointment("ap-next"),
      fsmAppointment("ap-replacement", {
        serviceIds: ["item-replacement"],
        scheduledStart: "2026-10-05T10:00:00+05:30",
        scheduledEnd: "2026-10-05T12:15:00+05:30",
      }),
    ]);
    expect(await prompt()).toBeNull();
  });

  it(RULES[0], async () => {
    const ids = await mirror([done("ap-done", "2026-09-10")]);
    await signIn();
    await giveAddress();
    await issueInvoice(ids["ap-done"] ?? "", 10);
    const invoice = { visit_id: ids["ap-done"], date: "2026-09-10", type: "service" };
    // Fitted, nothing booked, and the invoice 10 days old: the next visit leads and the invoice is the second line.
    expect(await home()).toMatchObject({ prompt: { kind: "next_visit", type: "service" }, invoice });
    await issueInvoice(ids["ap-done"] ?? "", 15);
    expect(await home()).toMatchObject({ prompt: { kind: "next_visit" }, invoice: null });
  });

  it("holds the replacement back while an invoice is ready, then offers it", async () => {
    const ids = await mirror([done("ap-done", "2026-09-10"), fsmAppointment("ap-next")]);
    await signIn();
    await giveAddress();
    await fitPiece("2026-10-05");
    await issueInvoice(ids["ap-done"] ?? "", 3);
    expect(await home()).toEqual(
      expect.objectContaining({
        prompt: null,
        invoice: { visit_id: ids["ap-done"], date: "2026-09-10", type: "service" },
      }),
    );
    await issueInvoice(ids["ap-done"] ?? "", 15);
    expect(await home()).toMatchObject({ prompt: { kind: "replacement_due", month: "2026-10" }, invoice: null });
  });

  it("asks nothing of someone with nothing booked", async () => {
    await env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name) VALUES ('p1', ?1, ?2, 'Rohit Malhotra')",
    )
      .bind(NOW.toISOString(), MOBILE)
      .run();
    await signIn();
    expect(await (await get("/api/me")).json()).toMatchObject({
      state: "nothing_booked",
      prompt: null,
      invoice: null,
    });
  });

  // PLAT-15: the app waits on Home each time it opens, and each D1 read is a round trip to the database's region. The
  // reads that need nothing from each other go together, so Home waits on a few trips, not one for each read.
  it("waits on few round trips to D1, even with the replacement leading, the longest way through", async () => {
    await mirror([done("ap-done", "2026-09-10"), fsmAppointment("ap-next")]);
    await signIn();
    await giveAddress();
    await fitPiece("2026-10-05");

    const answer = await get("/api/me");

    expect((await answer.json<{ prompt: unknown }>()).prompt).toMatchObject({ kind: "replacement_due" });
    expect(d1TripsOf(answer)).toBeLessThanOrEqual(ME_TRIPS);
  });

  it("waits on as few for a lead whose booking from the site has no visit yet", async () => {
    await phaseOneLead(MOBILE);
    await signIn();

    const answer = await get("/api/me");

    expect((await answer.json<{ consultation: unknown }>()).consultation).not.toBeNull();
    expect(d1TripsOf(answer)).toBeLessThanOrEqual(ME_TRIPS);
  });
});

describe("what was done on a visit (board C9)", () => {
  it("is the checklist the technician ticked, in the job sheet's order", async () => {
    const ids = await mirror([done("ap-done", "2026-09-10")]);
    await signIn();
    const visitId = ids["ap-done"] ?? "";
    await env.DB.prepare(
      "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t-1', 'sr-t1', 'T', 'T', 1, ?1)",
    )
      .bind(NOW.toISOString())
      .run();
    const event = (id: string, body: object, superseded = 0) =>
      env.DB.prepare(
        `INSERT INTO job_events (id, appointment_id, event_id, technician_id, kind, body, occurred_at, received_at,
           superseded, updated_at) VALUES (?1, ?2, ?1, 't-1', 'checklist', ?3, ?4, ?4, ?5, ?4)`,
      )
        .bind(id, visitId, JSON.stringify(body), NOW.toISOString(), superseded)
        .run();
    await event("e-refused", { done: ["piece_removed", "scalp_cleaned", "piece_cleaned"] }, 1);
    await event("e-1", { done: ["piece_refitted", "piece_removed"] });

    const visit = await (await get(`/api/visits/${visitId}`)).json<{ what_was_done: string[] | null }>();
    expect(visit.what_was_done).toEqual(["PLACEHOLDER Piece removed", "PLACEHOLDER Piece refitted"]);
  });

  it("is in the words ops gave the checklist in the console, an item since taken off still named", async () => {
    const ids = await mirror([done("ap-done", "2026-09-10")]);
    await signIn();
    const visitId = ids["ap-done"] ?? "";
    await env.DB.prepare(
      "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t-1', 'sr-t1', 'T', 'T', 1, ?1)",
    )
      .bind(NOW.toISOString())
      .run();
    // Ops renamed two of the committed items, added one, and took one off (docs/decisions/0087-consumables-and-stock.md).
    const item = (code: string, label: string, position: number, retired: string | null) =>
      env.DB.prepare(
        `INSERT INTO checklist_items (visit_type, code, label, position, retired_at, set_by, set_at)
         VALUES ('service', ?1, ?2, ?3, ?4, 'ops@maneman.in', ?5)`,
      ).bind(code, label, position, retired, NOW.toISOString());
    await env.DB.batch([
      item("piece_removed", "Took the piece off", 0, null),
      item("scalp_massaged", "Scalp massaged", 1, null),
      item("piece_refitted", "Put the piece back on", 2, null),
      item("scalp_cleaned", "Scalp cleaned", 3, NOW.toISOString()),
    ]);
    await env.DB.prepare(
      `INSERT INTO job_events (id, appointment_id, event_id, technician_id, kind, body, occurred_at, received_at,
         superseded, updated_at) VALUES ('e-1', ?1, 'e-1', 't-1', 'checklist', ?2, ?3, ?3, 0, ?3)`,
    )
      .bind(
        visitId,
        JSON.stringify({ done: ["scalp_cleaned", "piece_refitted", "scalp_massaged", "piece_removed"] }),
        NOW.toISOString(),
      )
      .run();

    const visit = await (await get(`/api/visits/${visitId}`)).json<{ what_was_done: string[] | null }>();
    expect(visit.what_was_done).toEqual([
      "Took the piece off",
      "Scalp massaged",
      "Put the piece back on",
      "Scalp cleaned",
    ]);
  });

  it("is null for a visit with no checklist recorded, closed in FSM's own screens", async () => {
    const ids = await mirror([done("ap-done", "2026-09-10")]);
    await signIn();
    const visit = await (await get(`/api/visits/${ids["ap-done"] ?? ""}`)).json<{ what_was_done: unknown }>();
    expect(visit.what_was_done).toBeNull();
  });
});

describe("a visit paid for ahead (board C1's Prepaid)", () => {
  it("is prepaid once a payment for it is captured, or a credit covers it, and not otherwise", async () => {
    const ids = await mirror([
      fsmAppointment("ap-paid"),
      fsmAppointment("ap-credit", { scheduledStart: "2026-09-25T10:00:00+05:30" }),
      fsmAppointment("ap-unpaid", { scheduledStart: "2026-09-26T10:00:00+05:30" }),
    ]);
    await signIn();
    const person = await env.DB.prepare("SELECT id FROM people WHERE mobile_e164 = ?1")
      .bind(MOBILE)
      .first<{ id: string }>();
    await env.DB.prepare(
      `INSERT INTO payments (id, person_id, appointment_id, razorpay_payment_id, amount, currency, status, captured_at,
         created_at, updated_at) VALUES ('pay-1', ?1, ?2, 'pay_1', 236000, 'INR', 'captured', ?3, ?3, ?3)`,
    )
      .bind(person?.id, ids["ap-paid"], NOW.toISOString())
      .run();
    await env.DB.prepare(
      "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t-held', 'sr-held', 'T', 'T', 1, ?1)",
    )
      .bind(NOW.toISOString())
      .run();
    await env.DB.prepare(
      `INSERT INTO slot_holds (id, person_id, type, date, window_label, technician_id, start_unit, amount, amount_ex_gst,
         gst_percent, state, appointment_id, expires_at, created_at, updated_at, use_credit)
       VALUES ('hold-1', ?1, 'service', '2026-09-25', 'morning', 't-held', 0, 0, 0, 0, 'booked', ?2, ?3, ?3, ?3, 1)`,
    )
      .bind(person?.id, ids["ap-credit"], NOW.toISOString())
      .run();

    const visits = await (await get("/api/visits")).json<{ upcoming: { id: string; prepaid: boolean }[] }>();
    const prepaid = Object.fromEntries(visits.upcoming.map((visit) => [visit.id, visit.prepaid]));
    expect(prepaid).toEqual({
      [ids["ap-paid"] ?? ""]: true,
      [ids["ap-credit"] ?? ""]: true,
      [ids["ap-unpaid"] ?? ""]: false,
    });
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
    await env.DB.prepare("UPDATE photos SET thumbnail_key = r2_key").run();
    const [photo] = (
      await (
        await get(`/api/visits/${ids["ap-done"] ?? ""}`)
      ).json<{
        photos: { after: { url: string; thumbnail_url: string }[] };
      }>()
    ).photos.after;
    const url = photo?.url ?? "";

    const other = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000005', 'Other')",
    )
      .bind(other, NOW.toISOString())
      .run();
    cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: other, deviceLabel: null, now: NOW })}`;
    expect((await get(`/api/visits/${ids["ap-done"] ?? ""}`)).status).toBe(404);
    expect((await get(url)).status).toBe(404);
    expect((await get(photo?.thumbnail_url ?? "")).status).toBe(404);
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

  // The visit screen said "The invoice is still generating" of a visit whose invoice was held back as a draft on
  // purpose: a credit paid for it, or its total was not what the visit was sold for (ADR 0070).
  it("says an invoice held back is being checked, and one for a credit visit waits on a ruling", async () => {
    const ids = await mirror([done("ap-done", "2026-09-10"), done("ap-credit", "2026-09-12")]);
    await signIn();
    const held = async (fsmId: string) =>
      (await (await get(`/api/visits/${ids[fsmId] ?? ""}`)).json<{ invoice_held: unknown }>()).invoice_held;

    expect(await held("ap-done")).toBeNull();
    await env.DB.prepare("UPDATE appointments SET fsm_invoice_id = 'stub-41' WHERE id = ?1")
      .bind(ids["ap-done"] ?? "")
      .run();
    expect(await held("ap-done")).toBe("checking");
    await env.DB.prepare("UPDATE appointments SET invoice_issued_at = ?1 WHERE id = ?2")
      .bind(NOW.toISOString(), ids["ap-done"] ?? "")
      .run();
    expect(await held("ap-done")).toBeNull();

    // A credit paid for it: never sent until the CA rules how such a visit is invoiced (open point 14).
    const person = await env.DB.prepare("SELECT person_id FROM appointments WHERE id = ?1")
      .bind(ids["ap-credit"] ?? "")
      .first<string>("person_id");
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO credit_ledger (id, person_id, kind, visits, source_kind, source_id, expires_at, created_at)
         VALUES ('grant-1', ?1, 'grant', 3, 'referral', 'referral-1', '2027-09-21T06:30:00.000Z', ?2)`,
      ).bind(person, NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO credit_ledger (id, person_id, kind, visits, grant_id, source_kind, source_id, created_at)
         VALUES ('redeem-1', ?1, 'redeem', -1, 'grant-1', 'appointment', ?2, ?3)`,
      ).bind(person, ids["ap-credit"] ?? "", NOW.toISOString()),
    ]);
    expect(await held("ap-credit")).toBe("credit");
  });

  // LIFE-07: a no-show read as an ordinary past visit, with no outcome, no charge and no word.
  it("says the client was not home, how long we waited, and what ops ruled", async () => {
    const ids = await mirror([
      fsmAppointment("ap-missed", {
        status: "Terminated",
        scheduledStart: "2026-09-19T10:00:00+05:30",
        scheduledEnd: "2026-09-19T11:30:00+05:30",
      }),
    ]);
    await signIn();
    const visit = ids["ap-missed"] ?? "";
    await env.DB.batch([
      env.DB.prepare("UPDATE visits SET outcome = 'no_show', partial_reason = NULL"),
      env.DB.prepare(
        `INSERT INTO checkins (id, appointment_id, technician_id, at, lat, lng, radius_m, passed, created_at)
         SELECT 'checkin-1', ?1, id, '2026-09-19T04:32:00.000Z', 28.4, 77.0, 200, 1, '2026-09-19T04:32:00.000Z'
         FROM technicians LIMIT 1`,
      ).bind(visit),
      env.DB.prepare(
        `INSERT INTO no_show_cases (id, checkin_id, appointment_id, wait_started_at, wait_ends_at, closed_at,
           decision, created_at)
         VALUES ('case-1', 'checkin-1', ?1, '2026-09-19T04:32:00.000Z', '2026-09-19T04:47:00.000Z',
           '2026-09-19T04:48:00.000Z', 'undecided', '2026-09-19T04:48:00.000Z')`,
      ).bind(visit),
    ]);
    const detail = async () => (await get(`/api/visits/${visit}`)).json<{ outcome: string | null; no_show: unknown }>();

    expect(await detail()).toMatchObject({
      outcome: "no_show",
      no_show: { decision: "undecided", waited_minutes: 16 },
    });
    await env.DB.prepare(
      "UPDATE no_show_cases SET decision = 'charged', charge = 'visit', kept_amount = 200000, refund_amount = 0",
    ).run();
    expect((await detail()).no_show).toEqual({
      decision: "charged",
      waited_minutes: 16,
      charge: { kept: 200000, credit_spent: false },
      dispute: null,
      disputable: true,
    });
  });

  interface Links {
    readonly url: string;
    readonly thumbnail_url: string | null;
  }
  const afterPhotos = async (visitId: string) =>
    (await (await get(`/api/visits/${visitId}`)).json<{ photos: { after: Links[] } }>()).photos.after;

  it("links a photograph's small copy for the rows, and none for one copied from FSM", async () => {
    const ids = await mirror([done("ap-done", "2026-09-10")]);
    await signIn();
    const [fromFsm] = await afterPhotos(ids["ap-done"] ?? "");
    expect(fromFsm?.thumbnail_url).toBeNull();

    const small = syntheticJpeg(300, 400, "small");
    await env.CLIENT_PHOTOS.put("visits/small-copy.jpg", small);
    await env.DB.prepare("UPDATE photos SET thumbnail_key = 'visits/small-copy.jpg'").run();
    const [fromTheApp] = await afterPhotos(ids["ap-done"] ?? "");
    const image = await get(fromTheApp?.thumbnail_url ?? "");
    expect(image.status).toBe(200);
    expect(image.headers.get("Content-Type")).toBe("image/jpeg");
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(small);
    expect((await get(fromTheApp?.thumbnail_url ?? "", false)).status).toBe(401);
    // The link to the photograph itself is still the whole photograph, which the sheet opens.
    expect((await (await get(fromTheApp?.url ?? "")).arrayBuffer()).byteLength).not.toBe(small.byteLength);
  });

  it("serves the photograph itself through a small copy's link when the copy is missing from the bucket", async () => {
    const ids = await mirror([done("ap-done", "2026-09-10")]);
    await signIn();
    await env.DB.prepare("UPDATE photos SET thumbnail_key = 'visits/never-stored-small.jpg'").run();
    const [photo] = await afterPhotos(ids["ap-done"] ?? "");
    const image = await get(photo?.thumbnail_url ?? "");
    expect(image.status).toBe(200);
    const whole = await get(photo?.url ?? "");
    expect(await image.arrayBuffer()).toEqual(await whole.arrayBuffer());
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
