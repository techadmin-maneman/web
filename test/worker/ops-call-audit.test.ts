// The entry each call to the ops console writes (src/http/audit.ts): whose record it opened and the path called, one
// entry for a look repeated within ten minutes, and none for the health check or a path no route answers. Every
// address and ID is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/http/context.ts";
import { appFor, fakeDependencies, markDatabase, NOW, request } from "./helpers.ts";

const CLIENT = "0d1e2f30-0000-4000-8000-000000000001";
const OTHER_CLIENT = "0d1e2f30-0000-4000-8000-000000000002";
const VISIT = "0a1b2c3d-0000-4000-8000-000000000001";

let clock: Date;

/** The ops console, called by this member of staff, on the test's clock. */
function opsAs(email: string): App {
  const access = { verify: () => Promise.resolve({ ok: true as const, identity: { kind: "staff" as const, email } }) };
  return appFor("local", fakeDependencies({ access, now: () => clock }), {}, "ops");
}

const minutesOn = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

const post = (app: App, path: string) =>
  request(app, path, {
    method: "POST",
    headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
    body: JSON.stringify({ code: "WELCOME" }),
  });

interface CallRow {
  actor: string;
  subject_kind: string | null;
  subject_id: string | null;
  detail: { method: string; route: string; path: string };
}

async function calls(): Promise<CallRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT actor, subject_kind, subject_id, detail FROM audit_log WHERE action = 'ops.call' ORDER BY id",
  ).all<Omit<CallRow, "detail"> & { detail: string }>();
  return results.map((row) => ({ ...row, detail: JSON.parse(row.detail) as CallRow["detail"] }));
}

beforeEach(async () => {
  clock = NOW;
  await markDatabase();
});

describe("whose record a call opened", () => {
  it("names the client whose record was opened, and the path called", async () => {
    await request(opsAs("care@maneman.in"), `/api/clients/${CLIENT}/photos`);

    expect(await calls()).toEqual([
      {
        actor: "care@maneman.in",
        subject_kind: "person",
        subject_id: CLIENT,
        detail: { method: "GET", route: "/api/clients/:id/photos", path: `/api/clients/${CLIENT}/photos` },
      },
    ]);
  });

  it("names the visit a call acted on", async () => {
    await post(opsAs("care@maneman.in"), `/api/visits/${VISIT}/discount-code`);

    expect(await calls()).toMatchObject([{ subject_kind: "appointment", subject_id: VISIT }]);
  });

  it("names no one for a call about no one's record", async () => {
    await request(opsAs("care@maneman.in"), "/api/storage");

    expect(await calls()).toEqual([
      {
        actor: "care@maneman.in",
        subject_kind: null,
        subject_id: null,
        detail: { method: "GET", route: "/api/storage", path: "/api/storage" },
      },
    ]);
  });

  // The log said a route was called, never whose record it was.
  it("keeps nothing but an ID from a path: a number typed in its place stays out of the log", async () => {
    await request(opsAs("care@maneman.in"), "/api/clients/9876543210");

    expect(await calls()).toEqual([
      {
        actor: "care@maneman.in",
        subject_kind: null,
        subject_id: null,
        detail: { method: "GET", route: "/api/clients/:id", path: "/api/clients/:id" },
      },
    ]);
  });
});

describe("what is not written", () => {
  // Most of the log was the health check and paths no route answers.
  it("writes nothing for the health check, or for a path no route answers", async () => {
    const ops = opsAs("care@maneman.in");

    expect((await request(ops, "/api/health")).status).toBe(200);
    expect((await request(ops, "/api/no-such-thing")).status).toBe(404);
    const deleted = await request(ops, "/api/storage", {
      method: "DELETE",
      headers: { Origin: "https://maneman.test" },
    });
    expect(deleted.status).toBe(404);
    expect(await calls()).toEqual([]);
  });

  it("writes one entry for a look repeated within ten minutes, and another once they have passed", async () => {
    const ops = opsAs("dispatch@maneman.in");

    await request(ops, "/api/dispatch");
    clock = minutesOn(4);
    await request(ops, "/api/dispatch");
    clock = minutesOn(9);
    await request(ops, "/api/dispatch");
    expect(await calls()).toHaveLength(1);

    clock = minutesOn(20);
    await request(ops, "/api/dispatch");
    expect(await calls()).toHaveLength(2);
  });

  it("writes each client's record opened, each member of staff's look, and every change", async () => {
    await request(opsAs("care@maneman.in"), `/api/clients/${CLIENT}`);
    await request(opsAs("care@maneman.in"), `/api/clients/${OTHER_CLIENT}`);
    await request(opsAs("lead@maneman.in"), `/api/clients/${CLIENT}`);
    await post(opsAs("care@maneman.in"), `/api/visits/${VISIT}/discount-code`);
    await post(opsAs("care@maneman.in"), `/api/visits/${VISIT}/discount-code`);

    expect((await calls()).map((row) => [row.actor, row.detail.method, row.subject_id])).toEqual([
      ["care@maneman.in", "GET", CLIENT],
      ["care@maneman.in", "GET", OTHER_CLIENT],
      ["lead@maneman.in", "GET", CLIENT],
      ["care@maneman.in", "POST", VISIT],
      ["care@maneman.in", "POST", VISIT],
    ]);
  });
});
