// Saved answers for the Care inbox (src/domain/care/quick-replies.ts, src/routes/ops/quick-replies.ts;
// docs/decisions/0141-quick-replies.md): a Customer Care manager adds and retires them, and Care read the list.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { captureLogs, markDatabase, request } from "../helpers.ts";
import { enforce, listStaff, opsAs, person } from "../ops/staff-fixtures.ts";

const LEAD = "lead@maneman.test";
const CARE = "care@maneman.test";

const post = (app: App, path: string, body?: unknown) =>
  request(app, path, {
    method: "POST",
    headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const listed = async () =>
  (await (await request(opsAs(person(CARE)), "/api/quick-replies")).json<{ replies: { title: string }[] }>()).replies;

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  await listStaff(LEAD, ["customer_care:manage:national"]);
  await listStaff(CARE, ["customer_care:act:national"]);
});

describe("quick replies", () => {
  it("are added and retired by a manager, read by Care by title, and audited", async () => {
    const lead = opsAs(person(LEAD));
    const added = await post(lead, "/api/quick-replies", {
      title: "Running late",
      text: "Hi {name}, your technician is about 20 minutes away.",
    });
    const { id } = await added.json<{ id: string }>();
    await post(lead, "/api/quick-replies", { title: "Booked", text: "You're booked for {next_visit}." });
    expect((await listed()).map((reply) => reply.title)).toEqual(["Booked", "Running late"]);
    expect((await post(lead, `/api/quick-replies/${id}/retire`)).status).toBe(200);
    expect((await listed()).map((reply) => reply.title)).toEqual(["Booked"]);
    expect((await post(lead, `/api/quick-replies/${id}/retire`)).status).toBe(404);
    const { results } = await env.DB.prepare(
      "SELECT action FROM audit_log WHERE action LIKE 'quick_reply.%' ORDER BY id",
    ).all();
    expect(results.map((row) => row.action)).toEqual(["quick_reply.add", "quick_reply.add", "quick_reply.retire"]);
  });

  it("are a manager's to keep, once the Staff list is enforced", async () => {
    await enforce();
    const refused = await post(opsAs(person(CARE)), "/api/quick-replies", { title: "Hello", text: "Hi {name}." });
    expect(refused.status).toBe(403);
  });
});
