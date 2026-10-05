// Blackout days, set by ops in Settings (src/routes/ops/blackouts.ts,
// docs/decisions/0088-every-policy-in-the-console.md). NOW is Monday 21 September
// 2026, 12 noon in India. Nothing here is a real person or number.
//
// A day blacked out is offered to nobody (docs/decisions/0068-a-paid-hold-is-kept.md);
// what these hold is that ops can add and remove one without the runbook's SQL,
// that each change is recorded under the Access identity behind it, and that a
// day already booked is named rather than quietly emptied.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { loadBlackouts } from "../../../src/domain/occupancy.ts";
import { appFor, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";

let ops: App;

interface Blackout {
  date: string;
  reason: string;
  set_by: string | null;
  set_at: string | null;
  booked: number;
}

const listed = async () =>
  (await (await request(ops, "/api/blackouts")).json<{ blackouts: Blackout[]; today: string }>()).blackouts;

const post = (path: string, body: unknown) =>
  request(ops, path, {
    method: "POST",
    headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const audited = (action: string) =>
  env.DB.prepare("SELECT actor, subject_id, detail FROM audit_log WHERE action = ?1 ORDER BY id")
    .bind(action)
    .all<{ actor: string; subject_id: string; detail: string }>();

beforeEach(async () => {
  await markDatabase();
  ops = appFor("local", fakeDependencies(), {}, "ops");
});

describe("GET /api/blackouts", () => {
  it("lists the days from today on, with who added each, and leaves the past out", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO visit_blackouts (date, reason) VALUES ('2026-09-01', 'Past')"),
      env.DB.prepare(
        "INSERT INTO visit_blackouts (date, reason, set_by, set_at) VALUES ('2026-10-20', 'Diwali', 'ops@maneman.in', ?1)",
      ).bind(NOW.toISOString()),
      // Written by the runbook's SQL before the console had a screen for it.
      env.DB.prepare("INSERT INTO visit_blackouts (date, reason) VALUES ('2026-09-21', 'Today')"),
    ]);
    expect(await listed()).toEqual([
      { date: "2026-09-21", reason: "Today", set_by: null, set_at: null, booked: 0 },
      { date: "2026-10-20", reason: "Diwali", set_by: "ops@maneman.in", set_at: NOW.toISOString(), booked: 0 },
    ]);
  });

  it("counts the visits still booked on each day, which a blackout does not move", async () => {
    await env.DB.prepare("INSERT INTO visit_blackouts (date, reason) VALUES ('2026-10-20', 'Diwali')").run();
    for (const [id, start, status] of [
      ["visit-1", "2026-10-20T03:30:00.000Z", "scheduled"], // 9 am in India on the 20th
      ["visit-2", "2026-10-19T18:30:00.000Z", "dispatched"], // midnight in India, the 20th
      ["visit-3", "2026-10-19T18:29:00.000Z", "scheduled"], // 11:59 pm on the 19th
      ["visit-4", "2026-10-20T06:30:00.000Z", "cancelled"],
    ]) {
      await env.DB.prepare(
        `INSERT INTO appointments (id, fsm_id, status, fsm_status, window_start, fsm_modified_at, synced_at)
         VALUES (?1, ?1, ?2, ?2, ?3, ?4, ?4)`,
      )
        .bind(id, status, start, NOW.toISOString())
        .run();
    }
    expect((await listed())[0]?.booked).toBe(2);
  });
});

describe("POST /api/blackouts", () => {
  it("blacks out every day from the first to the last, which booking then offers to nobody", async () => {
    const answer = await post("/api/blackouts", { from: "2026-10-20", to: "2026-10-22", reason: "Diwali" });
    expect(answer.status).toBe(200);
    const body = await answer.json<{ blackouts: Blackout[] }>();
    expect(body.blackouts.map((each) => [each.date, each.reason, each.set_by])).toEqual([
      ["2026-10-20", "Diwali", "ops@localhost"],
      ["2026-10-21", "Diwali", "ops@localhost"],
      ["2026-10-22", "Diwali", "ops@localhost"],
    ]);
    expect([...(await loadBlackouts(env.DB, "2026-10-19", "2026-10-23"))].sort()).toEqual([
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
    ]);
  });

  // The reason is text ops type, and the audit log holds IDs, counts and codes only and is never blanked (ADR 0031),
  // so it lives in visit_blackouts alone.
  it("records who added them and which days, in the same batch, and never the reason", async () => {
    await post("/api/blackouts", { from: "2026-10-20", to: "2026-10-22", reason: "Diwali" });
    const { results } = await audited("blackout.add");
    expect(results).toEqual([
      {
        actor: "ops@localhost",
        subject_id: "2026-10-20",
        detail: JSON.stringify({ from: "2026-10-20", to: "2026-10-22", days: 3, replaced: "[]" }),
      },
    ]);
    expect(results[0]?.detail).not.toContain("Diwali");
  });

  // Review of #145, item 6: which days a change replaced, and who had set each, would otherwise be lost.
  it("gives a day already blacked out the reason given now, and records which days it replaced and who set them", async () => {
    await env.DB.prepare("INSERT INTO visit_blackouts (date, reason) VALUES ('2026-10-21', 'Staff training')").run();
    await post("/api/blackouts", { from: "2026-10-20", to: "2026-10-20", reason: "Diwali" });
    await post("/api/blackouts", { from: "2026-10-20", to: "2026-10-21", reason: "Diwali, and the day after" });
    expect((await listed()).map((each) => each.reason)).toEqual([
      "Diwali, and the day after",
      "Diwali, and the day after",
    ]);
    const detail = (await audited("blackout.add")).results[1]?.detail ?? "{}";
    expect(JSON.parse((JSON.parse(detail) as { replaced: string }).replaced)).toEqual([
      { date: "2026-10-20", set_by: "ops@localhost" },
      { date: "2026-10-21", set_by: null },
    ]);
    expect(detail).not.toContain("Diwali");
    expect(detail).not.toContain("Staff training");
  });

  it("refuses a day already past, a last day before the first, and more than a month in one go", async () => {
    for (const [body, field] of [
      [{ from: "2026-09-20", to: "2026-09-22", reason: "Past" }, "from"],
      [{ from: "2026-10-22", to: "2026-10-20", reason: "Backwards" }, "to"],
      [{ from: "2026-10-01", to: "2026-11-01", reason: "Too long" }, "to"],
      // A year typed wrong is refused before a day of it is counted (review of #145, item 4).
      [{ from: "2026-10-01", to: "2062-10-01", reason: "Typed wrong" }, "to"],
      [{ from: "2026-10-01", to: "9999-12-31", reason: "Typed wrong" }, "to"],
    ] as const) {
      const answer = await post("/api/blackouts", body);
      expect(answer.status, JSON.stringify(body)).toBe(400);
      expect(await answer.json()).toMatchObject({ error: { code: "invalid_request", fields: [field] } });
    }
    expect(await listed()).toEqual([]);
    expect((await audited("blackout.add")).results).toEqual([]);
  });

  it("refuses a day with no reason, or one that opens as a spreadsheet formula would", async () => {
    for (const reason of ["", "  ", "=HYPERLINK(1)", "A".repeat(61)]) {
      const answer = await post("/api/blackouts", { from: "2026-10-20", to: "2026-10-20", reason });
      expect(answer.status, reason).toBe(400);
      expect(await answer.json()).toMatchObject({ error: { fields: ["reason"] } });
    }
  });

  it("takes today, since a visit may still be booked for later in it", async () => {
    expect((await post("/api/blackouts", { from: "2026-09-21", to: "2026-09-21", reason: "Rain" })).status).toBe(200);
  });
});

describe("POST /api/blackouts/remove", () => {
  it("offers the days again, and records who did it", async () => {
    await post("/api/blackouts", { from: "2026-10-20", to: "2026-10-22", reason: "Diwali" });
    const answer = await post("/api/blackouts/remove", { from: "2026-10-21", to: "2026-10-22" });
    expect(answer.status).toBe(200);
    expect((await answer.json<{ blackouts: Blackout[] }>()).blackouts.map((each) => each.date)).toEqual(["2026-10-20"]);
    const removed = JSON.stringify([
      { date: "2026-10-21", set_by: "ops@localhost" },
      { date: "2026-10-22", set_by: "ops@localhost" },
    ]);
    expect((await audited("blackout.remove")).results).toEqual([
      {
        actor: "ops@localhost",
        subject_id: "2026-10-21",
        detail: JSON.stringify({ from: "2026-10-21", to: "2026-10-22", days: 2, removed }),
      },
    ]);
  });

  // Review of #145, item 3: the list runs days together, so one press may name more than a month.
  it("offers a run of days again however long it is, since removing only takes back what is held", async () => {
    await post("/api/blackouts", { from: "2026-10-01", to: "2026-10-31", reason: "Monsoon works" });
    await post("/api/blackouts", { from: "2026-11-01", to: "2026-11-10", reason: "Monsoon works" });
    const answer = await post("/api/blackouts/remove", { from: "2026-10-01", to: "2026-11-10" });
    expect(answer.status).toBe(200);
    expect((await answer.json<{ blackouts: Blackout[] }>()).blackouts).toEqual([]);
    expect(JSON.parse((await audited("blackout.remove")).results[0]?.detail ?? "{}")).toMatchObject({ days: 41 });
  });

  it("answers not_found when none of the days is blacked out, and records nothing", async () => {
    expect((await post("/api/blackouts/remove", { from: "2026-10-20", to: "2026-10-22" })).status).toBe(404);
    expect((await audited("blackout.remove")).results).toEqual([]);
  });

  it("leaves a day already past as it was", async () => {
    await env.DB.prepare("INSERT INTO visit_blackouts (date, reason) VALUES ('2026-09-01', 'Past')").run();
    const answer = await post("/api/blackouts/remove", { from: "2026-09-01", to: "2026-09-01" });
    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({ error: { fields: ["from"] } });
  });
});

it("belongs to the ops surface alone", async () => {
  const client = appFor("local", fakeDependencies(), {}, "client");
  expect((await request(client, "/api/blackouts")).status).toBe(404);
});
