// The client app's visits and photographs, read from D1. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { appFor, d1TripsOf, fakeDependencies, markDatabase, NOW, phaseOneLead, request } from "../helpers.ts";
import { syntheticJpeg } from "../tryon-fixtures.ts";
import { MOBILE, NAMES, type Visit, booked, done, PHOTOS, utc, cookie, signIn } from "./client-visits-fixtures.ts";

/** The most round trips to D1 Home may wait on in turn. It waited on 17 when each read waited for the one before. */
const ME_TRIPS = 6;

/** Our IDs for the visits written so far in this test, by name. */
let ids: Record<string, string>;

/** Writes each visit not written yet, with its client, technician and photographs, and returns our IDs by name. */
async function seed(visits: Visit[]): Promise<Record<string, string>> {
  const at = NOW.toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO technicians (id, fsm_id, name, initials, active, updated_at)
     VALUES ('t-imran', 't-imran', 'Imran Khan', 'IK', 1, ?1)`,
  )
    .bind(at)
    .run();
  for (const visit of visits) {
    if (ids[visit.name] !== undefined) continue;
    const id = crypto.randomUUID();
    ids[visit.name] = id;
    const closed = visit.status === "completed" || visit.status === "terminated";
    const minutes =
      visit.startedAt !== null && visit.endedAt !== null
        ? (Date.parse(visit.endedAt) - Date.parse(visit.startedAt)) / 60_000
        : null;
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO people (id, created_at, mobile_e164, name) SELECT ?1, ?2, ?3, ?4
         WHERE NOT EXISTS (SELECT 1 FROM people WHERE mobile_e164 = ?3)`,
      ).bind(crypto.randomUUID(), at, visit.mobile, NAMES[visit.mobile] ?? null),
      env.DB.prepare(
        `INSERT INTO appointments (id, fsm_id, person_id, type, tier, window_start, window_end, technician_id, status,
           service_city, service_pincode, synced_at, first_seen_at)
         SELECT ?1, ?1, id, ?2, ?3, ?4, ?5, 't-imran', ?6, 'Gurgaon', '122018', ?7, ?7 FROM people
         WHERE mobile_e164 = ?8`,
      ).bind(
        id,
        visit.type,
        visit.type === "consultation" ? null : "standard",
        utc(visit.start),
        utc(visit.end),
        visit.status,
        at,
        visit.mobile,
      ),
      ...(closed
        ? [
            env.DB.prepare(
              `INSERT INTO visits (id, appointment_id, started_at, ended_at, duration_minutes, outcome, updated_at)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
            ).bind(
              crypto.randomUUID(),
              id,
              utc(visit.startedAt),
              utc(visit.endedAt),
              minutes,
              visit.status === "completed" ? "done" : "partial",
              at,
            ),
          ]
        : []),
    ]);
    for (const [phase, angle, width, height] of PHOTOS[visit.name] ?? []) {
      const key = `visits/${id}/${phase}-${angle}.jpg`;
      const bytes = syntheticJpeg(width, height);
      await env.CLIENT_PHOTOS.put(key, bytes);
      const set = crypto.randomUUID();
      await env.DB.batch([
        env.DB.prepare("INSERT INTO photo_sets (id, appointment_id, phase, created_at) VALUES (?1, ?2, ?3, ?4)").bind(
          set,
          id,
          phase,
          at,
        ),
        env.DB.prepare(
          `INSERT INTO photos (id, photo_set_id, angle, r2_key, content_type, bytes, width, height, taken_at, created_at)
           VALUES (?1, ?2, ?3, ?4, 'image/jpeg', ?5, ?6, ?7, ?8, ?9)`,
        ).bind(crypto.randomUUID(), set, angle, key, bytes.byteLength, width, height, utc(visit.startedAt) ?? at, at),
      ]);
    }
  }
  return ids;
}

let client: App;

const get = (path: string, withCookie = true) =>
  request(client, path, { headers: withCookie ? { Cookie: cookie } : {} });

beforeEach(async () => {
  client = appFor("local", fakeDependencies(), {}, "client");
  ids = {};
  await markDatabase();
});

// Home's one prompt, in its order (src/policy/home-prompt.ts): an address to give while something is
// booked, then the next service due and not booked, then an invoice just issued, which is also a line of its own
// beneath whichever prompt leads, then a replacement falling due within reach.
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
    await seed([done("ap-done", "2026-09-10"), booked("ap-next")]);
    await signIn();
    await fitPiece("2026-10-05");
    expect(await prompt()).toEqual({ kind: "address" });
  });

  it("then offers the next service, due a month after the last visit, in its window, while nothing is booked", async () => {
    await seed([done("ap-done", "2026-09-10")]);
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
    await seed([done("ap-done", "2026-09-10")]);
    await signIn();
    await giveAddress();
    // The service falls due on 10 October and the piece in November, inside the 45 days a visit may be booked ahead.
    await fitPiece("2026-11-03");
    expect(await prompt()).toMatchObject({ kind: "next_visit", type: "service", replacement_bookable: true });
  });

  it("says nothing of a replacement whose month is past the booking horizon", async () => {
    await seed([done("ap-done", "2026-09-10"), booked("ap-next")]);
    await signIn();
    await giveAddress();
    // March is past the 45 days a visit may be booked ahead: nothing to say about it yet.
    await fitPiece("2027-03-09");
    expect(await home()).toMatchObject({ prompt: null, invoice: null });
  });

  it("offers to book the replacement once its month is within reach, and never while one is booked", async () => {
    await seed([done("ap-done", "2026-09-10"), booked("ap-next")]);
    await signIn();
    await giveAddress();
    await fitPiece("2026-10-05");
    // A service visit is booked, and October is within the 45 days a visit may be booked ahead.
    expect(await prompt()).toEqual({ kind: "replacement_due", month: "2026-10", tier: "standard" });

    // The replacement is booked: Home's card shows it, and the prompt no longer offers a second.
    await seed([
      done("ap-done", "2026-09-10"),
      booked("ap-next"),
      booked("ap-replacement", {
        type: "replacement",
        start: "2026-10-05T10:00:00+05:30",
        end: "2026-10-05T12:15:00+05:30",
      }),
    ]);
    expect(await prompt()).toBeNull();
  });

  it("leads with the next visit, and keeps the invoice as a second line for 14 days", async () => {
    const ids = await seed([done("ap-done", "2026-09-10")]);
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
    const ids = await seed([done("ap-done", "2026-09-10"), booked("ap-next")]);
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

  // The app waits on Home each time it opens, and each D1 read is a round trip to the database's region. The
  // reads that need nothing from each other go together, so Home waits on a few trips, not one for each read.
  it("waits on few round trips to D1, even with the replacement leading, the longest way through", async () => {
    await seed([done("ap-done", "2026-09-10"), booked("ap-next")]);
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

describe("what was done on a visit", () => {
  it("is the checklist the technician ticked, in the job sheet's order", async () => {
    const ids = await seed([done("ap-done", "2026-09-10")]);
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
    expect(visit.what_was_done).toEqual(["Hair system removed", "Hair system refitted"]);
  });

  it("is in the words ops gave the checklist in the console, an item since taken off still named", async () => {
    const ids = await seed([done("ap-done", "2026-09-10")]);
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

  it("is null for a visit closed with no checklist recorded", async () => {
    const ids = await seed([done("ap-done", "2026-09-10")]);
    await signIn();
    const visit = await (await get(`/api/visits/${ids["ap-done"] ?? ""}`)).json<{ what_was_done: unknown }>();
    expect(visit.what_was_done).toBeNull();
  });
});
