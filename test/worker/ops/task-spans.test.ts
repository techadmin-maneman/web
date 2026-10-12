// Each task's span: opened from the task's own start the first hour the board holds it, closed the first hour it is
// gone, and the Care cases the reporting copy counts from them. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { careCaseRows } from "../../../src/domain/analytics/care-cases.ts";
import { recordTaskSpans } from "../../../src/domain/ops/task-spans.ts";
import type { Task } from "../../../src/domain/ops/tasks.ts";
import type { TaskGroup } from "../../../src/policy/tasks.ts";
import { client } from "../clients.ts";
import { NOW } from "../helpers.ts";

const task = (group: TaskGroup, id: string, person: string | null): Task => ({
  id,
  group,
  person: person === null ? null : { id: person, name: "Rohit Malhotra", mobile: null },
  visit: null,
  detail: null,
  since: "2026-09-18T05:00:00.000Z",
  due: "2026-09-19T05:00:00.000Z",
  episode: "",
  owner: null,
});

const board = (tasks: Task[], truncated = false) => ({ tasks, truncated });
const LATER = new Date("2026-09-21T08:30:00Z");

const spans = async () =>
  (
    await env.DB.prepare(
      "SELECT task_group, subject_id, city, opened_at, closed_at FROM task_spans ORDER BY opened_at, subject_id",
    ).all()
  ).results;

beforeEach(async () => {
  await client("p-rohit", "+919810000001", "Rohit Malhotra");
  await client("p-test", "+919810000003", "Karan Test");
  await env.DB.prepare("UPDATE people SET test_record = 1 WHERE id = 'p-test'").run();
});

describe("each task's span", () => {
  it("opens from the task's own start, leaving out grievances and records marked as tests", async () => {
    const tasks = [
      task("at_risk_client", "v1", "p-rohit"),
      task("at_risk_client", "v2", "p-test"),
      task("grievance", "g1", "p-rohit"),
    ];

    expect(await recordTaskSpans(env.DB, board(tasks), NOW)).toEqual({ opened: 2, closed: 0 });

    expect(await spans()).toEqual([
      {
        task_group: "at_risk_client",
        subject_id: "v1",
        city: "Gurgaon",
        opened_at: "2026-09-18T05:00:00.000Z",
        closed_at: null,
      },
    ]);
  });

  it("closes the span of a task gone from the board, and opens a new one if it comes back", async () => {
    await recordTaskSpans(env.DB, board([task("first_fit_to_book", "p-rohit", "p-rohit")]), NOW);

    expect(await recordTaskSpans(env.DB, board([]), LATER)).toEqual({ opened: 0, closed: 1 });
    expect((await spans())[0]?.closed_at).toBe(LATER.toISOString());

    await recordTaskSpans(env.DB, board([task("first_fit_to_book", "p-rohit", "p-rohit")]), LATER);
    expect((await spans()).map((span) => span.closed_at)).toEqual([LATER.toISOString(), null]);
  });

  it("closes nothing while the board is cut short, since a task still open may be missing from it", async () => {
    await recordTaskSpans(env.DB, board([task("at_risk_client", "v1", "p-rohit")]), NOW);

    expect(await recordTaskSpans(env.DB, board([], true), LATER)).toEqual({ opened: 0, closed: 0 });
  });

  it("makes each a Care case in the reporting copy, beside each grievance, marking one closed by hand", async () => {
    await recordTaskSpans(env.DB, board([task("at_risk_client", "v1", "p-rohit")]), NOW);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO task_closures (id, task_group, subject_id, reason, closed_by, closed_at)
         VALUES ('c1', 'at_risk_client', 'v1', 'Moved abroad', 'ops@maneman.in', '2026-09-21T08:00:00.000Z')`,
      ),
      env.DB.prepare(
        `INSERT INTO grievances (id, person_id, text, state, resolved_at, created_at)
         VALUES ('g1', 'p-rohit', 'Please call first.', 'resolved', '2026-09-20T05:00:00.000Z', '2026-09-19T05:00:00.000Z')`,
      ),
    ]);
    await recordTaskSpans(env.DB, board([]), LATER);

    const cases = (await careCaseRows(env.DB)).rows;

    expect(cases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          case_key: "g:g1",
          kind: "grievance",
          city: "Gurgaon",
          opened_date: "2026-09-19",
          closed_date: "2026-09-20",
          closed_without_doing: false,
        }),
        expect.objectContaining({
          kind: "task",
          task_group: "at_risk_client",
          opened_date: "2026-09-18",
          closed_date: "2026-09-21",
          closed_without_doing: true,
        }),
      ]),
    );
    expect(cases.every((row) => !String(row.case_key).includes("v1"))).toBe(true);
  });
});
