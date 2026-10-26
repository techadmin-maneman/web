// The technician's own month on their phone (src/routes/tech/month.ts): the visits they closed in it at their rates,
// and nobody else's. NOW is Monday 21 September 2026, 12 noon in India. Every name and figure here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { markDatabase } from "../helpers.ts";
import { AT, writeRow } from "../fixtures/rows.ts";
import { IMRAN, JOB, working, type Working } from "../job-fixtures.ts";

interface Month {
  month: string;
  lines: { kind: string; visits: number; rate: number | null; amount: number | null }[];
}

let job: Working;

beforeEach(async () => {
  await markDatabase();
  job = await working("service");
  const grade = crypto.randomUUID();
  await writeRow("pay_grades", { id: grade, name: "Senior", created_by: "finance@maneman.in", created_at: AT }, {});
  await writeRow(
    "visit_pay_rates",
    {
      id: crypto.randomUUID(),
      grade_id: grade,
      visit_kind: "service",
      amount: 45_000,
      effective_from: "2026-09-01",
      set_by: "finance@maneman.in",
      set_at: AT,
    },
    {},
  );
  await env.DB.prepare("UPDATE technicians SET pay_grade_id = ?2 WHERE id = ?1").bind(IMRAN, grade).run();
});

describe("the technician's month", () => {
  it("lists the visits they closed this month at their rate", async () => {
    await job.workTo("outcome");
    await job.post(`/api/tech/jobs/${JOB}/outcome`, { outcome: "done" }, "event-outcome-01");
    const answer = await job.get("/api/tech/month");
    expect(answer.status).toBe(200);
    const month = await answer.json<Month>();
    expect(month.month).toBe("2026-09");
    expect(month.lines).toEqual([
      expect.objectContaining({ kind: "service", visits: 1, rate: 45_000, amount: 45_000 }),
    ]);
  });

  it('pays a fit closed "Can\'t fit today" at the consultation rate, its free refit paying the fit', async () => {
    await env.DB.prepare("UPDATE appointments SET type = 'first_fit' WHERE id = ?1").bind(JOB).run();
    await writeRow(
      "visit_pay_rates",
      {
        id: crypto.randomUUID(),
        grade_id: (
          await env.DB.prepare("SELECT pay_grade_id AS id FROM technicians WHERE id = ?1")
            .bind(IMRAN)
            .first<{ id: string }>()
        )?.id,
        visit_kind: "consultation",
        amount: 20_000,
        effective_from: "2026-09-01",
        set_by: "finance@maneman.in",
        set_at: AT,
      },
      {},
    );
    await job.workTo("piece");
    const closed = await job.post(
      `/api/tech/jobs/${JOB}/outcome`,
      { outcome: "partial", reason: "no_piece", cannot_fit: true },
      "event-outcome-02",
    );
    expect(closed.status).toBe(202);
    const month = await (await job.get("/api/tech/month")).json<Month>();
    expect(month.lines).toEqual([
      expect.objectContaining({ kind: "consultation", visits: 1, rate: 20_000, amount: 20_000 }),
    ]);
  });

  it("is empty before any is closed, and for a month asked for with none", async () => {
    expect((await (await job.get("/api/tech/month")).json<Month>()).lines).toEqual([]);
    expect((await (await job.get("/api/tech/month?month=2026-08")).json<Month>()).lines).toEqual([]);
    expect((await job.get("/api/tech/month?month=2026-13")).status).toBe(400);
  });
});
