// A technician's alerts (docs/decisions/0250-guides-and-alerts.md): the inbox is theirs alone, newest first, naming the
// client only while the job is theirs and unlocked; kinds turn off; a phone subscribes only with a push service's
// address. NOW is Monday 21 September 2026, 12 noon in India; Rohit's visit is at 1 pm. Every name and number here is
// made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { NOW } from "../clock.ts";
import { markDatabase } from "../helpers.ts";
import { IMRAN, JOB, SAMEER, working, type Working } from "../job-fixtures.ts";

let job: Working;

const HOUR_MS = 60 * 60_000;
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR_MS).toISOString();

async function alertFor(technicianId: string, fields: { id: string; kind: string; job: string | null; sent: string }) {
  await env.DB.prepare(
    `INSERT INTO tech_alerts (id, technician_id, kind, appointment_id, date, starts_at, leave_by, drive_minutes,
       once_key, sent_at)
     VALUES (?1, ?2, ?3, ?4, '2026-09-21', '2026-09-21T07:30:00.000Z', '2026-09-21T07:10:00.000Z', 18, ?1, ?5)`,
  )
    .bind(fields.id, technicianId, fields.kind, fields.job, fields.sent)
    .run();
}

interface Inbox {
  alerts: { id: string; read: boolean; client_name: string | null; navigate: string | null; sector: string | null }[];
  settings: Record<string, boolean>;
  push_key: string | null;
}
const inbox = async () => (await job.get("/api/tech/alerts")).json<Inbox>();

beforeEach(async () => {
  await markDatabase();
  job = await working("service");
});

describe("the inbox", () => {
  it("is the technician's own over the last seven days, newest first, with the client and the way there", async () => {
    await alertFor(IMRAN, { id: "older", kind: "job_moved", job: JOB, sent: ago(3) });
    await alertFor(IMRAN, { id: "newer", kind: "time_to_leave", job: JOB, sent: ago(1) });
    await alertFor(IMRAN, { id: "gone-by", kind: "time_to_leave", job: JOB, sent: ago(8 * 24) });
    await alertFor(SAMEER, { id: "not-theirs", kind: "time_to_leave", job: JOB, sent: ago(1) });

    const read = await inbox();
    expect(read.alerts.map((alert) => alert.id)).toEqual(["newer", "older"]);
    expect(read.alerts[0]).toMatchObject({ read: false, client_name: "Rohit Malhotra", sector: "Sector 65" });
    expect(read.alerts[0]?.navigate).toBe("https://www.google.com/maps/dir/?api=1&destination=28.398%2C77.07");
    expect(read.settings).toEqual({ time_to_leave: true, day_ahead: true, job_changes: true, running_over: true });
    // No keys are set here, so the phone asks for no notifications.
    expect(read.push_key).toBeNull();
  });

  it("names no client of a job given to another technician", async () => {
    await alertFor(IMRAN, { id: "moved-on", kind: "job_reassigned", job: JOB, sent: ago(1) });
    await env.DB.prepare("UPDATE appointments SET technician_id = ?2 WHERE id = ?1").bind(JOB, SAMEER).run();
    const [alert] = (await inbox()).alerts;
    expect(alert).toMatchObject({ id: "moved-on", client_name: null, sector: null, navigate: null });
  });

  it("is all read once opened", async () => {
    await alertFor(IMRAN, { id: "new", kind: "time_to_leave", job: JOB, sent: ago(1) });
    expect((await job.post("/api/tech/alerts/read", undefined, "alerts-read")).status).toBe(204);
    expect((await inbox()).alerts[0]?.read).toBe(true);
  });
});

describe("the kinds on", () => {
  it("turn off and on again, and answer as they now stand", async () => {
    const off = await job.patch("/api/tech/alerts/settings", { day_ahead: false, running_over: false });
    expect(await off.json()).toEqual({ time_to_leave: true, day_ahead: false, job_changes: true, running_over: false });
    const on = await job.patch("/api/tech/alerts/settings", { day_ahead: true });
    expect(await on.json()).toEqual({ time_to_leave: true, day_ahead: true, job_changes: true, running_over: false });
    expect((await job.patch("/api/tech/alerts/settings", { weather: false })).status).toBe(400);
  });
});

describe("a phone's push subscription", () => {
  const subscribe = (endpoint: string) => job.post("/api/tech/push-subscriptions", { endpoint }, "subscribe");
  const kept = async () =>
    (await env.DB.prepare("SELECT endpoint FROM push_subscriptions").all<{ endpoint: string }>()).results;

  it("is kept, one a phone, the newest address", async () => {
    expect((await subscribe("https://fcm.googleapis.com/fcm/send/first")).status).toBe(201);
    expect((await subscribe("https://fcm.googleapis.com/fcm/send/second")).status).toBe(201);
    expect(await kept()).toEqual([{ endpoint: "https://fcm.googleapis.com/fcm/send/second" }]);
  });

  it("is refused for any address but a browser's push service", async () => {
    expect((await subscribe("https://example.com/hook")).status).toBe(400);
    expect((await subscribe("http://fcm.googleapis.com/fcm/send/plain")).status).toBe(400);
    expect(await kept()).toEqual([]);
  });
});
