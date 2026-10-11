// The Care team's days off and cover (src/domain/care/cover.ts, src/routes/ops/care-rota.ts;
// docs/decisions/0134-care-cover.md): a manager sets weekly days off and leave, and on a day a Care person is off, the
// member on with the fewest clients covers their chats. NOW is Monday 21 September. Every address here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { markDatabase, captureLogs, NOW, request } from "../helpers.ts";
import { insertPerson } from "../tryon-fixtures.ts";
import { technician } from "../clients.ts";
import { enforce, listStaff, opsAs, person } from "../ops/staff-fixtures.ts";

const ASHA = "asha@maneman.test";
const RAVI = "ravi@maneman.test";
const LEAD = "lead@maneman.test";
const MONDAY = 1;

const post = (app: App, path: string, body?: unknown) =>
  request(app, path, {
    method: "POST",
    headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

interface Member {
  email: string;
  weekly_off: number[];
  leave: { id: string; from: string; to: string }[];
  off_today: boolean;
  covered_by: string | null;
}

const team = async () => (await (await request(opsAs(person(ASHA)), "/api/care-team")).json<{ team: Member[] }>()).team;
const memberOf = async (email: string) => (await team()).find((member) => member.email === email);

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  await listStaff(ASHA, ["customer_care:act:national"]);
  await listStaff(RAVI, ["customer_care:act:national"]);
  await listStaff(LEAD, ["customer_care:manage:national"]);
  await insertPerson("p1", "+919810000001", "Arjun Mehta");
  const at = NOW.toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO care_owners (person_id, email, since, assigned_by) VALUES ('p1', ?1, ?2, 'system')",
    ).bind(ASHA, at),
    env.DB.prepare(
      `INSERT INTO conversations (id, person_id, mobile_e164, state, opened_at, last_message_at, last_inbound_at,
         created_at, updated_at)
       VALUES ('8c1d9f4b-5e6a-4b7c-9d8e-3f4a5b6c7d8e', 'p1', '+919810000001', 'open', ?1, ?1, ?1, ?1, ?1)`,
    ).bind(at),
    // The whole team on shift, so only a day off or leave puts one of them off.
    env.DB.prepare("UPDATE staff SET on_shift_since = ?1").bind(at),
  ]);
});

describe("a shift", () => {
  it("is each member's own to go on and off, and off it their chats are covered", async () => {
    const asha = opsAs(person(ASHA));
    expect((await post(asha, "/api/care-team/shift", { on: false })).status).toBe(200);
    expect(await memberOf(ASHA)).toMatchObject({
      on_shift_since: null,
      off_today: true,
      day_off: false,
      covered_by: LEAD,
    });
    await post(asha, "/api/care-team/shift", { on: true });
    expect(await memberOf(ASHA)).toMatchObject({
      on_shift_since: NOW.toISOString(),
      off_today: false,
      covered_by: null,
    });
    const answer = await request(asha, "/api/care-team");
    expect(await answer.json()).toMatchObject({ me: ASHA });
  });

  it("is only for the Care team", async () => {
    await listStaff("viewer@maneman.test", ["customer_care:view:national"]);
    const refused = await post(opsAs(person("viewer@maneman.test")), "/api/care-team/shift", { on: true });
    expect(await refused.json()).toMatchObject({ error: { code: "invalid_request", fields: ["on"] } });
  });
});

describe("days off", () => {
  it("are set by a manager, week by week, and put the member off on the day", async () => {
    const lead = opsAs(person(LEAD));
    expect((await post(lead, "/api/care-team/days-off", { email: ASHA, weekdays: [MONDAY, 0] })).status).toBe(200);
    expect(await memberOf(ASHA)).toMatchObject({ weekly_off: [0, MONDAY], off_today: true, covered_by: LEAD });
    const { results } = await env.DB.prepare(
      "SELECT action, subject_id, detail FROM audit_log WHERE action = 'care_rota.set'",
    ).all();
    expect(results).toEqual([
      { action: "care_rota.set", subject_id: ASHA, detail: JSON.stringify({ weekdays: "0,1" }) },
    ]);
  });

  it("include leave, which a manager adds and takes back", async () => {
    const lead = opsAs(person(LEAD));
    const added = await post(lead, "/api/care-team/leave", { email: RAVI, from: "2026-09-21", to: "2026-09-23" });
    const { id } = await added.json<{ id: string }>();
    expect(await memberOf(RAVI)).toMatchObject({
      leave: [{ id, from: "2026-09-21", to: "2026-09-23" }],
      off_today: true,
    });
    expect((await post(lead, `/api/care-team/leave/${id}/delete`)).status).toBe(200);
    expect(await memberOf(RAVI)).toMatchObject({ leave: [], off_today: false, covered_by: null });
    expect((await post(lead, `/api/care-team/leave/${id}/delete`)).status).toBe(404);
  });

  it("refuse someone off the Care team, and leave that has ended or ends before it starts", async () => {
    const lead = opsAs(person(LEAD));
    const outsider = await post(lead, "/api/care-team/days-off", { email: "viewer@maneman.test", weekdays: [0] });
    expect(await outsider.json()).toMatchObject({ error: { code: "invalid_request", fields: ["email"] } });
    for (const [from, to] of [
      ["2026-09-10", "2026-09-12"],
      ["2026-09-25", "2026-09-24"],
    ]) {
      const refused = await post(lead, "/api/care-team/leave", { email: RAVI, from, to });
      expect(await refused.json()).toMatchObject({ error: { code: "invalid_request", fields: ["to"] } });
    }
  });

  it("are a Customer Care manager's to set, once the Staff list is enforced", async () => {
    await enforce();
    expect((await post(opsAs(person(ASHA)), "/api/care-team/days-off", { email: RAVI, weekdays: [0] })).status).toBe(
      403,
    );
  });
});

describe("the name clients see", () => {
  it("is set by a manager, shown with the team, and audited", async () => {
    const lead = opsAs(person(LEAD));
    expect((await post(lead, "/api/care-team/name", { email: ASHA, name: " Asha " })).status).toBe(200);
    expect(await memberOf(ASHA)).toMatchObject({ name: "Asha" });
    expect(await memberOf(RAVI)).toMatchObject({ name: null });
    const refused = await post(lead, "/api/care-team/name", { email: "viewer@maneman.test", name: "Vik" });
    expect(await refused.json()).toMatchObject({ error: { code: "invalid_request", fields: ["email"] } });
    const { results } = await env.DB.prepare("SELECT detail FROM audit_log WHERE action = 'care_name.set'").all();
    expect(results).toEqual([{ detail: JSON.stringify({ name: "Asha" }) }]);
  });
});

describe("moving every client", () => {
  it("moves all of one member's clients to another on the team, audited with how many", async () => {
    const answer = await post(opsAs(person(LEAD)), "/api/care-team/move-all", { from: ASHA, to: RAVI });
    expect(await answer.json()).toEqual({ moved: 1 });
    expect(await env.DB.prepare("SELECT email FROM care_owners WHERE person_id = 'p1'").first()).toEqual({
      email: RAVI,
    });
    const { results } = await env.DB.prepare(
      "SELECT subject_id, detail FROM audit_log WHERE action = 'care_person.move_all'",
    ).all();
    expect(results).toEqual([{ subject_id: ASHA, detail: JSON.stringify({ to: RAVI, clients: 1 }) }]);
  });

  it("lists someone off the team who still has clients, to move them, and refuses moving to anyone off it", async () => {
    await env.DB.prepare("UPDATE staff SET active = 0 WHERE email = ?1").bind(ASHA).run();
    expect(await memberOf(ASHA)).toMatchObject({ on_team: false, clients: 1 });
    const refused = await post(opsAs(person(LEAD)), "/api/care-team/move-all", { from: RAVI, to: ASHA });
    expect(await refused.json()).toMatchObject({ error: { code: "invalid_request", fields: ["to"] } });
  });
});

describe("a technician writing to our number", () => {
  it("is labelled as one of ours", async () => {
    await technician();
    await env.DB.prepare("UPDATE technicians SET mobile_e164 = '+919810000099'").run();
    await env.DB.prepare(
      `INSERT INTO conversations (id, person_id, mobile_e164, state, opened_at, last_message_at, last_inbound_at,
         created_at, updated_at)
       VALUES ('9d2e0a5c-6f7b-4c8d-8e9f-4a5b6c7d8e9f', NULL, '+919810000099', 'open', ?1, ?1, ?1, ?1, ?1)`,
    )
      .bind(NOW.toISOString())
      .run();
    const listed = await (
      await request(opsAs(person(ASHA)), "/api/conversations?view=all")
    ).json<{
      conversations: { mobile: string; technician: { name: string } | null }[];
    }>();
    expect(listed.conversations.find((chat) => chat.mobile === "+919810000099")?.technician).toMatchObject({
      name: "Imran Qureshi",
    });
  });
});

describe("cover in the inbox", () => {
  it("puts an off Care person's chats in the cover's own, and says who covers on each", async () => {
    await post(opsAs(person(LEAD)), "/api/care-team/days-off", { email: ASHA, weekdays: [MONDAY] });
    const mine = async (email: string) =>
      (
        await (
          await request(opsAs(person(email)), "/api/conversations?view=mine")
        ).json<{
          conversations: { care_person: string; covered_by: string | null }[];
        }>()
      ).conversations;
    // Ravi and the lead both have no clients; between equals, the first by address covers.
    expect(await mine(LEAD)).toMatchObject([{ care_person: ASHA, covered_by: LEAD }]);
    expect(await mine(ASHA)).toHaveLength(1);
    expect(await mine(RAVI)).toEqual([]);
  });
});
