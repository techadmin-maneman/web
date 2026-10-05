// The technician's day: which jobs a phone is shown and when, the roster ops keep, and a phone ops revoked.
// NOW is Monday 21 September 2026, 12 noon in India. Every name, number and photograph here is made up.

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { openTechnicianSession } from "../../src/domain/technicians.ts";
import { NOW, request } from "./helpers.ts";
import {
  ADDRESS,
  bindings,
  DEVICE,
  get,
  IMRAN,
  insertJob,
  LATER_JOB,
  ops,
  opsPost,
  OTHER_JOB,
  SAMEER,
  TODAY_JOB,
  useFieldDay,
} from "./field-fixtures.ts";

useFieldDay();

describe("the day's jobs", () => {
  it("hides the address, access notes and client card until the day before", async () => {
    const answer = await get(`/api/tech/jobs/${LATER_JOB}`);
    const job = await answer.json<Record<string, unknown>>();

    expect(answer.status).toBe(200);
    expect(job).toMatchObject({
      unlocked: false,
      // Time, type and sector, and nothing else of the place.
      type: "service",
      sector: "Sector 65",
      address: null,
      access_notes: null,
      client: null,
      // 6 pm in India on the day before the visit (src/policy/job-visibility.ts).
      unlocks_at: "2026-09-24T12:30:00.000Z",
    });
    expect(JSON.stringify(job)).not.toContain("House 7");
    expect(JSON.stringify(job)).not.toContain("9810000001");
  });

  // ADR 0069: the board names the area of the pincode a visit is booked for; the technician's card used the address.
  it("names the area of the visit's pincode, as the dispatch board does", async () => {
    await env.DB.prepare(
      "INSERT INTO serviceable_pincodes (pincode, area, city, served) VALUES ('122018', 'Sector 65 and 66', 'Gurgaon', 1)",
    ).run();

    const later = await (await get(`/api/tech/jobs/${LATER_JOB}`)).json<Record<string, unknown>>();
    const listed = await (await get("/api/tech/jobs?date=2026-09-25")).json<{ jobs: Record<string, unknown>[] }>();

    expect(later).toMatchObject({ unlocked: false, sector: "Sector 65 and 66" });
    expect(listed.jobs[0]).toMatchObject({ id: LATER_JOB, sector: "Sector 65 and 66" });
  });

  it("shows the address, access notes and client card from the day before", async () => {
    const job = await (await get(`/api/tech/jobs/${TODAY_JOB}`)).json<Record<string, unknown>>();

    expect(job).toMatchObject({
      unlocked: true,
      day: "today",
      address: { line1: "House 7", locality: "Sector 65", lat: ADDRESS.lat },
      access_notes: "Gate 4417, visitor bay B",
      client: { name: "Rohit Malhotra", mobile: "+919810000001" },
    });
  });

  it("gives the whole address the client saved: building, tower, floor, flat and landmark", async () => {
    await env.DB.prepare(
      `UPDATE addresses SET building = 'Emerald Heights', tower = 'C', floor = '14', flat = '1402',
         landmark = 'Opposite the water tank' WHERE id = 'addr-1'`,
    ).run();

    const job = await (await get(`/api/tech/jobs/${TODAY_JOB}`)).json<{ address: Record<string, unknown> }>();

    expect(job.address).toMatchObject({
      line1: "House 7",
      building: "Emerald Heights",
      tower: "C",
      floor: "14",
      flat: "1402",
      landmark: "Opposite the water tank",
    });
  });

  it("marks a visit the price book charges nothing for as free, still with no amount", async () => {
    await insertJob(OTHER_JOB, { start: "2026-09-21T10:30:00.000Z", type: "consultation" });

    const answer = await get("/api/tech/jobs?date=2026-09-21");
    const body = await answer.text();

    const { jobs } = JSON.parse(body) as { jobs: { id: string; badge: string }[] };
    expect(jobs.map(({ id, badge }) => ({ id, badge }))).toEqual([
      { id: TODAY_JOB, badge: "prepaid" },
      { id: OTHER_JOB, badge: "free" },
    ]);
    expect(body).not.toMatch(/amount|price|rupee|"paise"/i);
  });

  // docs/decisions/0085-services-ops-can-edit.md: the badge is the visit's own service's, not the standard tier's.
  it("reads the badge from the visit's own service's price on its day", async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO services (kind, tier, name, minutes, sort, updated_by, updated_at)
         VALUES ('consultation', 'at_home', 'Consultation at home', 60, 1, 'ops@localhost', ?1)`,
      ).bind(NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from)
         VALUES ('consultation', 'at_home', 50000, 0, '2026-01-01')`,
      ),
    ]);
    await insertJob(OTHER_JOB, { start: "2026-09-21T10:30:00.000Z", type: "consultation" });
    await env.DB.prepare("UPDATE appointments SET tier = 'at_home' WHERE id = ?1").bind(OTHER_JOB).run();

    const { jobs } = await (
      await get("/api/tech/jobs?date=2026-09-21")
    ).json<{ jobs: { id: string; badge: string }[] }>();

    expect(jobs.find((job) => job.id === OTHER_JOB)?.badge).toBe("prepaid");
  });

  it("carries a badge and never an amount", async () => {
    const answer = await get("/api/tech/jobs?date=2026-09-21");
    const body = await answer.text();

    expect(JSON.parse(body)).toMatchObject({ date: "2026-09-21", jobs: [{ id: TODAY_JOB, badge: "prepaid" }] });
    expect(body).not.toMatch(/amount|price|rupee|"paise"/i);
  });

  it("is nobody else's job", async () => {
    await insertJob(OTHER_JOB, { start: "2026-09-21T07:30:00.000Z", technician: SAMEER });
    expect((await get(`/api/tech/jobs/${OTHER_JOB}`)).status).toBe(404);
  });
});

describe("the roster", () => {
  // Read in one query for the whole roster, where it was once a query a technician.
  it("lists each technician's phones, the latest used first, beside their leave", async () => {
    await openTechnicianSession(env.DB, {
      technicianId: SAMEER,
      deviceId: "phone-def-456",
      label: null,
      now: new Date(NOW.getTime() - 60_000),
    });
    const roster = await (
      await request(ops, "/api/technicians", {}, bindings())
    ).json<{
      technicians: { id: string; devices: { device_id: string; label: string | null }[]; leave: unknown[] }[];
    }>();

    expect(roster.technicians.map((each) => [each.id, each.devices, each.leave])).toEqual([
      [IMRAN, [expect.objectContaining({ device_id: DEVICE, label: "Chrome on Android" })], []],
      [SAMEER, [expect.objectContaining({ device_id: "phone-def-456", label: null })], []],
    ]);
  });
});

describe("a revoked phone", () => {
  it("is told to drop its cached jobs on its next call, and the wipe is recorded", async () => {
    expect((await get("/api/tech/jobs")).status).toBe(200);

    const revoked = await opsPost(`/api/technicians/${IMRAN}/devices/${DEVICE}/revoke`, {});
    expect(revoked.status).toBe(200);

    const answer = await get("/api/tech/jobs");
    expect(answer.status).toBe(401);
    expect(await answer.json()).toMatchObject({ error: { code: "device_revoked" } });
    const device = await env.DB.prepare("SELECT wiped_at FROM technician_devices WHERE device_id = ?1")
      .bind(DEVICE)
      .first<{ wiped_at: string | null }>();
    expect(device?.wiped_at).toBe(NOW.toISOString());
  });

  it("stops him signing in, which the roster shows until ops let him in again", async () => {
    await opsPost(`/api/technicians/${IMRAN}/devices/${DEVICE}/revoke`, {});
    const roster = async () =>
      (
        await (
          await request(ops, "/api/technicians", {}, bindings())
        ).json<{ technicians: { id: string; sign_in_stopped_at: string | null }[] }>()
      ).technicians.find((technician) => technician.id === IMRAN)?.sign_in_stopped_at;
    expect(await roster()).toBe(NOW.toISOString());

    const allowed = await opsPost(`/api/technicians/${IMRAN}/allow-sign-in`, {});
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ allowed: true });
    expect(await roster()).toBeNull();
    expect((await opsPost(`/api/technicians/${IMRAN}/allow-sign-in`, {})).status).toBe(404);
    const audited = await env.DB.prepare(
      "SELECT action FROM audit_log WHERE action = 'technician.allow_sign_in'",
    ).all();
    expect(audited.results).toHaveLength(1);
  });
});
