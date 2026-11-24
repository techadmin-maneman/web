// What each city has done towards a month's targets (src/domain/ops/target-progress.ts, src/routes/ops/targets.ts;
// docs/decisions/0317-targets-progress.md), each measure as the Funnel and the reporting copy count it. NOW is Monday
// 21 September 2026, 12 noon in India; the arrival window is the default 30 minutes.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { capacityRows } from "../../../src/domain/analytics/capacity.ts";
import { activeClientsBy } from "../../../src/domain/clients/active-clients.ts";
import { NOW } from "../clock.ts";
import { captureLogs, markDatabase, request } from "../helpers.ts";
import { aCheckin, aPayment, aPerson, aTechnician, aVisit } from "../fixtures/index.ts";
import { writeRow, type RowOf } from "../fixtures/rows.ts";
import { enforce, listStaff, opsAs, person } from "../ops/staff-fixtures.ts";

const ADMIN = "admin@maneman.test";
const GROWTH = "growth@maneman.test";

interface Progress {
  month: string;
  progress: { city: string; measure: string; actual: number | null }[];
}

const aLead = (row: RowOf<"leads">) =>
  writeRow(
    "leads",
    { id: crypto.randomUUID(), request_id: "request", source: "form", loss_extent: "crown", city: "Gurgaon" },
    row,
  );

const aConversion = (row: RowOf<"conversions">) =>
  writeRow(
    "conversions",
    {
      event_id: crypto.randomUUID(),
      subject_id: crypto.randomUUID(),
      attributed_channel: "direct",
      last_touch_channel: "direct",
      meta_state: "sent",
      google_state: "sent",
      created_at: "2026-09-20T00:00:00.000Z",
    },
    row,
  );

const aSpend = (row: RowOf<"spend_entries">) =>
  writeRow(
    "spend_entries",
    {
      id: crypto.randomUUID(),
      month: "2026-09",
      city: "Gurgaon",
      channel: "offline",
      entered_by: GROWTH,
      entered_at: "2026-09-20T00:00:00.000Z",
    },
    row,
  );

async function progressOf(month?: string): Promise<Progress> {
  const admin = opsAs(person(ADMIN));
  return (await request(admin, `/api/targets/progress${month === undefined ? "" : `?month=${month}`}`)).json();
}

const figure = (body: Progress, city: string, measure: string) =>
  body.progress.find((each) => each.city === city && each.measure === measure)?.actual;

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  await listStaff(ADMIN, ["admin:view:national"]);
  await listStaff(GROWTH, ["growth:manage:national"]);
});

describe("a month's progress towards its targets", () => {
  it("counts each client's first lead once, in that lead's city, in the month it came", async () => {
    const twice = await aPerson();
    await aLead({ person_id: twice.id, created_at: "2026-09-05T06:00:00.000Z" });
    await aLead({ person_id: twice.id, created_at: "2026-09-08T06:00:00.000Z", city: "Delhi" });
    await aLead({ person_id: (await aPerson()).id, created_at: "2026-09-09T06:00:00.000Z", city: "Delhi" });
    await aLead({ person_id: (await aPerson()).id, created_at: "2026-08-30T06:00:00.000Z" });
    await aLead({ person_id: (await aPerson({ test_record: 1 })).id, created_at: "2026-09-10T06:00:00.000Z" });

    const now = await progressOf();
    expect(now.month).toBe("2026-09");
    expect(figure(now, "Gurgaon", "leads")).toBe(1);
    expect(figure(now, "Delhi", "leads")).toBe(1);
    expect(figure(now, "Noida", "leads")).toBe(0);
    expect(figure(await progressOf("2026-08"), "Gurgaon", "leads")).toBe(1);
  });

  it("counts consultations done by the visit's city, and new clients, revenue and acquisition cost by the payment's", async () => {
    const gurgaon = await aVisit({ window_start: "2026-09-10T05:00:00.000Z" });
    const delhi = await aVisit({ window_start: "2026-09-11T05:00:00.000Z", service_city: "Delhi" });
    const client = { attributed_channel: "direct", last_touch_channel: "direct" } as const;
    for (const visit of [gurgaon, delhi]) {
      await aConversion({
        ...client,
        person_id: visit.person_id,
        event: "consult_done",
        subject_id: visit.id,
        occurred_at: visit.window_start,
      });
    }
    // A first fit of Rs. 35,400 (Rs. 30,000 before GST), Rs. 3,540 of it refunded: Rs. 27,000 brought in.
    const fit = await aPayment({
      person_id: gurgaon.person_id,
      appointment_id: gurgaon.id,
      amount: 3_540_000,
      amount_ex_gst: 3_000_000,
      refunded_amount: 354_000,
      captured_at: "2026-09-12T08:00:00.000Z",
    });
    await aConversion({
      ...client,
      person_id: gurgaon.person_id ?? "",
      event: "first_fit_paid",
      subject_id: fit.id,
      occurred_at: "2026-09-12T08:00:00.000Z",
    });
    await aPayment({
      person_id: gurgaon.person_id,
      appointment_id: gurgaon.id,
      captured_at: "2026-08-12T08:00:00.000Z",
    });
    await aSpend({ amount: 1_500_000 });
    await aSpend({ amount: 900_000, city: "Delhi" });
    await aSpend({ amount: 5_000_000, city: null });

    const now = await progressOf();
    expect(figure(now, "Gurgaon", "consultations")).toBe(1);
    expect(figure(now, "Delhi", "consultations")).toBe(1);
    expect(figure(now, "Gurgaon", "new_clients")).toBe(1);
    expect(figure(now, "Gurgaon", "revenue")).toBe(27_000);
    // The city's own spend over its new clients; Delhi spent with none, so has no cost to give.
    expect(figure(now, "Gurgaon", "cac")).toBe(15_000);
    expect(figure(now, "Delhi", "cac")).toBeNull();
    expect(figure(now, "Delhi", "revenue")).toBe(0);
  });

  it("gives the share of a city's visits done on time, and of its technicians' half-slots taken", async () => {
    const imran = await aTechnician();
    await aTechnician({ name: "Sandeep Yadav", initials: "SY", city: "Delhi" });
    await aTechnician({ name: "A tester", initials: "AT", city: "Noida", test_record: 1 });
    const done = { status: "completed", technician_id: imran.id } as const;
    const onTime = await aVisit({ ...done, window_start: "2026-09-14T05:00:00.000Z" });
    const late = await aVisit({ ...done, window_start: "2026-09-15T05:00:00.000Z" });
    await aCheckin({ id: onTime.id ?? "", technicianId: imran.id ?? "" }, { at: "2026-09-14T05:20:00.000Z" });
    await aCheckin({ id: late.id ?? "", technicianId: imran.id ?? "" }, { at: "2026-09-15T05:45:00.000Z" });

    const now = await progressOf();
    expect(figure(now, "Gurgaon", "on_time")).toBe(50);
    expect(figure(now, "Delhi", "on_time")).toBeNull();

    // The board's own half-slots, as the reporting copy reads them, for the month's days to today.
    const cities = new Map([[imran.id ?? "", "Gurgaon"]]);
    const { rows } = await capacityRows(env.DB, cities, { from: "2026-09-01", to: "2026-09-21", now: NOW });
    const mine = rows.filter((row) => row.day !== undefined && String(row.day) >= "2026-09-01");
    const open = mine.reduce((sum, row) => sum + Number(row.half_slots_open), 0);
    const taken = mine.reduce((sum, row) => sum + Number(row.half_slots_taken), 0);
    expect(taken).toBeGreaterThan(0);
    expect(figure(now, "Gurgaon", "utilisation")).toBe(Math.round((taken * 100) / open));
    expect(figure(now, "Delhi", "utilisation")).toBe(0);
    // A city whose only technician is a test record has nothing to count by.
    expect(figure(now, "Noida", "utilisation")).toBeNull();
  });

  it("counts active clients as Cities does for this month alone, and nothing for a month still to come", async () => {
    const now = await progressOf();
    const active = await activeClientsBy(env.DB, "city", { grace: 30, today: "2026-09-21" });
    for (const city of ["Gurgaon", "Delhi"]) {
      expect(figure(now, city, "active_clients")).toBe(active.get(city) ?? 0);
    }
    expect(figure(await progressOf("2026-08"), "Gurgaon", "active_clients")).toBeNull();
    const coming = await progressOf("2026-10");
    expect(coming.progress.length).toBeGreaterThan(0);
    expect(coming.progress.every((each) => each.actual === null)).toBe(true);
  });

  it("refuses a month outside the year either side, and is Admin's to read once the Staff list is enforced", async () => {
    const admin = opsAs(person(ADMIN));
    expect((await request(admin, "/api/targets/progress?month=2027-10")).status).toBe(400);
    await enforce();
    expect((await request(opsAs(person(ADMIN)), "/api/targets/progress")).status).toBe(200);
    expect((await request(opsAs(person(GROWTH)), "/api/targets/progress")).status).toBe(403);
  });
});
