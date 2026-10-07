// The entry a signed-in client's or technician's call writes (src/http/audit.ts), so the log holds every action and
// who made it, as it does each ops call: what a client changes, every step a technician sends and each job they open,
// with the phone it came from. Every name, number and ID is made up.

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { request } from "../helpers.ts";
import { asClient, signedIn } from "../clients.ts";
import {
  cookie,
  DOWN_THE_ROAD,
  get,
  IMRAN,
  PERSON,
  post,
  tech,
  TODAY_JOB,
  useFieldDay,
} from "../field/field-fixtures.ts";

const HOLD = "44444444-4444-4444-8444-444444444441";

interface CallRow {
  surface: string;
  actor_kind: string;
  actor: string;
  action: string;
  subject_kind: string | null;
  subject_id: string | null;
  detail: Record<string, string>;
}

async function calls(action: string): Promise<CallRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT surface, actor_kind, actor, action, subject_kind, subject_id, detail FROM audit_log
     WHERE action = ?1 ORDER BY id`,
  )
    .bind(action)
    .all<Omit<CallRow, "detail"> & { detail: string }>();
  return results.map((row) => ({ ...row, detail: JSON.parse(row.detail) as CallRow["detail"] }));
}

async function deviceRow(): Promise<string> {
  const device = await env.DB.prepare("SELECT id FROM technician_devices WHERE technician_id = ?1")
    .bind(IMRAN)
    .first<{ id: string }>();
  if (device === null) throw new Error("the field day signs a phone in");
  return device.id;
}

useFieldDay();

describe("a signed-in client's call", () => {
  it("is written under the client, with what it changed and the path called", async () => {
    const client = await signedIn(PERSON);

    await asClient(client, `/api/holds/${HOLD}`, { method: "DELETE" });

    expect(await calls("client.call")).toEqual([
      {
        surface: "client",
        actor_kind: "client",
        actor: PERSON,
        action: "client.call",
        subject_kind: "hold",
        subject_id: HOLD,
        detail: { method: "DELETE", route: "/api/holds/:id", path: `/api/holds/${HOLD}` },
      },
    ]);
  });

  it("writes nothing for a look at the client's own record, or an address being typed", async () => {
    const client = await signedIn(PERSON);

    await asClient(client, "/api/visits");
    await asClient(client, "/api/me");
    await asClient(client, "/api/address/suggestions", { method: "POST", body: { query: "Sector 65" } });

    expect(await calls("client.call")).toEqual([]);
  });

  it("writes nothing for a call with no session, which names no one", async () => {
    await asClient("mm_app=not-a-session", "/api/sessions/others", { method: "DELETE" });

    expect(await calls("client.call")).toEqual([]);
  });
});

describe("a signed-in technician's call", () => {
  it("is written under the technician, with the job, the step and the phone it came from", async () => {
    await post(`/api/tech/jobs/${TODAY_JOB}/checkin`, DOWN_THE_ROAD, "event-log-01");

    expect(await calls("tech.call")).toEqual([
      {
        surface: "tech",
        actor_kind: "technician",
        actor: IMRAN,
        action: "tech.call",
        subject_kind: "appointment",
        subject_id: TODAY_JOB,
        detail: {
          method: "POST",
          route: "/api/tech/jobs/:id/checkin",
          path: `/api/tech/jobs/${TODAY_JOB}/checkin`,
          device: await deviceRow(),
        },
      },
    ]);
  });

  it("writes each job opened, a client's address and number with it, once in ten minutes", async () => {
    await get(`/api/tech/jobs/${TODAY_JOB}`);
    await get(`/api/tech/jobs/${TODAY_JOB}`);

    expect((await calls("tech.call")).map((row) => [row.detail.method, row.subject_id])).toEqual([["GET", TODAY_JOB]]);
  });

  it("writes nothing for the day's list or who is signed in, which the app asks for all day", async () => {
    await get("/api/tech/jobs?date=2026-09-21");
    await get("/api/tech/me");

    expect(await calls("tech.call")).toEqual([]);
  });

  it("writes nothing for a photograph's bytes going up: the step that records it is written", async () => {
    await request(tech, "/api/tech/photos/an-upload-token", {
      method: "PUT",
      headers: { Cookie: cookie, Origin: "https://maneman.test", "Content-Type": "image/jpeg" },
      body: new Uint8Array([0xff, 0xd8, 0xff]),
    });

    expect(await calls("tech.call")).toEqual([]);
  });
});
