// What the app's availability waits on and reads (src/routes/client/availability.ts, src/domain/booking/day-plans.ts):
// its reads that need nothing from each other go together, and the days it plans are its own city's technicians' only,
// so another city's visits cost it nothing. NOW is Monday 21 September 2026, 12 noon in India.

import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { appFor, countRowsRead, d1TripsOf, fakeDependencies, markDatabase, request } from "../helpers.ts";
import { aPerson } from "../fixtures/index.ts";
import { DAY_MS, MINUTE_MS } from "../../../src/lib/durations.ts";
import { client, IMRAN, SANA, SANDEEP, technician, visit } from "./client-booking-fixtures.ts";

/**
 * The most round trips to D1 availability may wait on in turn, the first in an isolate, which reads the inputs ops set
 * too. It waited on ten before its reads that need nothing from each other went together.
 */
const AVAILABILITY_TRIPS = 6;

const DELHI = "t-delhi";

/** Delhi's visits over the two weeks: fourteen days, four a day. */
const DELHI_VISITS = 56;

let app: App;

const availability = (who: { cookie: string }) =>
  request(app, "/api/availability?type=service", { headers: { Cookie: who.cookie } });

/** A Delhi technician's two weeks ahead, DELHI_VISITS of them, four a day, for a Delhi client. */
async function busyInDelhi(): Promise<void> {
  const kabir = "0d1e2f30-0000-4000-8000-0000000000d1";
  await aPerson({ id: kabir, name: "Kabir Sood" });
  const starts = Array.from({ length: DELHI_VISITS }, (_, index) => {
    const day = Date.parse("2026-09-22T03:30:00.000Z") + Math.floor(index / 4) * DAY_MS;
    return new Date(day + (index % 4) * 150 * MINUTE_MS).toISOString();
  });
  await Promise.all(starts.map((start) => visit(kabir, "service", "scheduled", start, DELHI)));
}

beforeEach(async () => {
  await markDatabase();
  app = appFor("local", fakeDependencies(), {}, "client");
  await technician(IMRAN, "Imran Qureshi", "IQ");
  await technician(SANDEEP, "Sandeep Rawat", "SR");
  await technician(SANA, "Sana Mirza", "SM");
  await technician(DELHI, "Arjun Mehra", "AM", "Delhi");
});

describe("GET /api/availability", () => {
  it("waits on few round trips to D1", async () => {
    const rohit = await client();
    const answer = await availability(rohit);
    expect(answer.status).toBe(200);
    expect(d1TripsOf(answer)).toBeLessThanOrEqual(AVAILABILITY_TRIPS);
  });

  it("reads none of another city's days", async () => {
    const rohit = await client();
    // Once, so the reads every first request makes are behind it.
    expect((await availability(rohit)).status).toBe(200);
    const rowsRead = countRowsRead();
    await availability(rohit);
    const quiet = rowsRead();
    await busyInDelhi();
    const before = rowsRead();
    await availability(rohit);
    // A read of every one of them would add at least as many rows; what else a read touches varies by a few.
    expect(rowsRead() - before - quiet).toBeLessThan(DELHI_VISITS);
  });
});
