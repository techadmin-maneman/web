// What a technician's phone keeps when ops switch him off (apps/tech/src/store/set-aside.ts): the work it has not
// sent, for seven days and for him alone, and nothing of a client's beyond that work.

import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import type { CheckIn, Job, JobSummary, Me } from "../../apps/tech/src/api.ts";
import { wipe } from "../../apps/tech/src/store/db.ts";
import { deviceId, keepMe, keptMe } from "../../apps/tech/src/store/device.ts";
import { keepArrival, keepDay, keepJob, keptArrival, keptDay, keptJob } from "../../apps/tech/src/store/jobs.ts";
import { events, frames, keepFrame, queue } from "../../apps/tech/src/store/outbox.ts";
import { leaveSignedOut, settleSetAside } from "../../apps/tech/src/store/set-aside.ts";

afterEach(async () => {
  await wipe();
});

const IMRAN = "33333333-3333-4333-8333-333333333331";
const SAMEER = "33333333-3333-4333-8333-333333333332";
const JOB = "a0000000-0000-4000-8000-000000000001";
const DAY = "2030-09-02";
const SWITCHED_OFF_AT = Date.parse("2030-09-02T06:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

const me = (id: string) =>
  ({
    id,
    name: "Imran Qureshi",
    first_name: "Imran",
    initials: "IQ",
    device: { device_id: "phone", label: null, enrolled_at: "2030-09-01T04:00:00.000Z" },
  }) as Me;

/** A day on the phone: the list, a client's card, its check-in, and a step and a photograph not yet sent. */
async function aDaysWork(technicianId: string | null = IMRAN): Promise<string> {
  const phone = await deviceId();
  if (technicianId !== null) await keepMe(me(technicianId));
  await keepDay(DAY, [{ id: JOB, date: DAY } as JobSummary]);
  await keepJob({ id: JOB, client: { name: "Rohit Malhotra", mobile: "+919810000001", note: null } } as Job);
  await keepArrival(JOB, { passed: true, distance_m: 40 } as CheckIn);
  await queue("start", JOB, {});
  await keepFrame(JOB, "front", "before", new Blob(["frame"]));
  return phone;
}

async function unsent() {
  return { steps: (await events()).length, photographs: (await frames()).length };
}

describe("when ops switch a technician off", () => {
  it("keeps the work his phone has not sent, and drops the clients' cards and who he is", async () => {
    const phone = await aDaysWork();

    expect(await leaveSignedOut("technician_inactive", SWITCHED_OFF_AT)).toBe(true);

    expect(await unsent()).toEqual({ steps: 1, photographs: 1 });
    expect(await keptDay(DAY)).toBeNull();
    expect(await keptJob(JOB)).toBeNull();
    expect(await keptMe()).toBeNull();
    // The check-in's distance is the work's own, and names no client.
    expect(await keptArrival(JOB)).not.toBeNull();
    // The same phone signs in again, so the session it opens is bound to the device ops know.
    expect(await deviceId()).toBe(phone);
  });

  it("wipes the phone whole when it had nothing unsent", async () => {
    const phone = await deviceId();
    await keepMe(me(IMRAN));
    await keepJob({ id: JOB, client: null } as unknown as Job);

    expect(await leaveSignedOut("technician_inactive", SWITCHED_OFF_AT)).toBe(false);

    expect(await keptJob(JOB)).toBeNull();
    expect(await deviceId()).not.toBe(phone);
  });

  it("wipes the phone whole when it cannot tell whose the work is", async () => {
    await aDaysWork(null);

    expect(await leaveSignedOut("technician_inactive", SWITCHED_OFF_AT)).toBe(false);

    expect(await unsent()).toEqual({ steps: 0, photographs: 0 });
  });

  it("keeps it through a later sign-out for seven days, and then wipes it", async () => {
    await aDaysWork();
    await leaveSignedOut("technician_inactive", SWITCHED_OFF_AT);

    expect(await leaveSignedOut("session_required", SWITCHED_OFF_AT + 6 * DAY_MS)).toBe(true);
    expect(await unsent()).toEqual({ steps: 1, photographs: 1 });

    expect(await leaveSignedOut("session_required", SWITCHED_OFF_AT + 7 * DAY_MS)).toBe(false);
    expect(await unsent()).toEqual({ steps: 0, photographs: 0 });
  });

  it("does not start the seven days again when he is told a second time", async () => {
    await aDaysWork();
    await leaveSignedOut("technician_inactive", SWITCHED_OFF_AT);
    await leaveSignedOut("technician_inactive", SWITCHED_OFF_AT + 5 * DAY_MS);

    expect(await leaveSignedOut("session_required", SWITCHED_OFF_AT + 7 * DAY_MS)).toBe(false);
  });

  it("wipes it all when ops revoke the phone", async () => {
    await aDaysWork();
    await leaveSignedOut("technician_inactive", SWITCHED_OFF_AT);

    expect(await leaveSignedOut("device_revoked", SWITCHED_OFF_AT + DAY_MS)).toBe(false);

    expect(await unsent()).toEqual({ steps: 0, photographs: 0 });
  });
});

describe("any other end of a session", () => {
  it("wipes the phone whole, as it always has", async () => {
    await aDaysWork();

    expect(await leaveSignedOut("session_required", SWITCHED_OFF_AT)).toBe(false);
    expect(await leaveSignedOut(null, SWITCHED_OFF_AT)).toBe(false);

    expect(await unsent()).toEqual({ steps: 0, photographs: 0 });
  });
});

describe("signing in again", () => {
  it("lets his own work go on once he is switched back on, and keeps it no longer than any other", async () => {
    await aDaysWork();
    await leaveSignedOut("technician_inactive", SWITCHED_OFF_AT);

    await settleSetAside(IMRAN, SWITCHED_OFF_AT + 2 * DAY_MS);

    expect(await unsent()).toEqual({ steps: 1, photographs: 1 });
    // Set aside no more: a session that then ends wipes the phone whole.
    expect(await leaveSignedOut("session_required", SWITCHED_OFF_AT + 3 * DAY_MS)).toBe(false);
  });

  it("drops it when someone else signs in on the phone", async () => {
    await aDaysWork();
    await leaveSignedOut("technician_inactive", SWITCHED_OFF_AT);

    await settleSetAside(SAMEER, SWITCHED_OFF_AT + DAY_MS);

    expect(await unsent()).toEqual({ steps: 0, photographs: 0 });
    expect(await keptArrival(JOB)).toBeNull();
  });

  it("drops it when he signs in after the seven days", async () => {
    await aDaysWork();
    await leaveSignedOut("technician_inactive", SWITCHED_OFF_AT);

    await settleSetAside(IMRAN, SWITCHED_OFF_AT + 8 * DAY_MS);

    expect(await unsent()).toEqual({ steps: 0, photographs: 0 });
  });

  it("changes nothing on a phone with nothing set aside", async () => {
    await aDaysWork();

    await settleSetAside(SAMEER, SWITCHED_OFF_AT);

    expect(await unsent()).toEqual({ steps: 1, photographs: 1 });
  });
});
