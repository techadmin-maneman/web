// A technician's ask for leave from their phone (src/routes/tech/leave.ts), on Tasks for Operations, and decided from
// there (src/routes/ops/leave-requests.ts): an approval records the leave, a decline only the decision. NOW is Monday
// 21 September 2026, 12 noon in India. Every name here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { markDatabase, request } from "../helpers.ts";
import { IMRAN, working, type Working } from "../job-fixtures.ts";

interface Asks {
  requests: { id: string; from: string; to: string; note: string | null; state: string }[];
}

interface Board {
  groups: { group: string; tasks: { id: string; facts: Record<string, unknown> }[] }[];
}

let job: Working;

const ask = (body: object) => job.post("/api/tech/leave", body, crypto.randomUUID());

const leaveTasks = async () =>
  (await (await request(job.ops, "/api/tasks")).json<Board>()).groups.find((each) => each.group === "leave_request")
    ?.tasks ?? [];

beforeEach(async () => {
  await markDatabase();
  job = await working("service");
});

describe("a technician's ask for leave", () => {
  it("waits on Tasks, and once approved records the leave and leaves the board", async () => {
    const asked = await ask({ from: "2026-09-26", to: "2026-09-28", note: "Sister's wedding" });
    expect(asked.status).toBe(201);
    const [request0] = (await asked.json<Asks>()).requests;
    expect(request0).toMatchObject({ from: "2026-09-26", to: "2026-09-28", state: "asked" });

    const [task] = await leaveTasks();
    expect(task?.facts).toMatchObject({ technician: "Imran Qureshi", from: "2026-09-26", to: "2026-09-28" });

    const decided = await job.opsPost(`/api/leave-requests/${request0?.id ?? ""}/decision`, { decision: "approved" });
    expect(decided.status).toBe(204);
    expect(await leaveTasks()).toEqual([]);
    const leave = await env.DB.prepare("SELECT from_date, to_date FROM technician_leave WHERE technician_id = ?1")
      .bind(IMRAN)
      .all();
    expect(leave.results).toEqual([{ from_date: "2026-09-26", to_date: "2026-09-28" }]);
    const mine = await (await job.get("/api/tech/leave")).json<Asks>();
    expect(mine.requests[0]?.state).toBe("approved");

    // Decided once: a second decision is refused, and records nothing more.
    const again = await job.opsPost(`/api/leave-requests/${request0?.id ?? ""}/decision`, { decision: "declined" });
    expect(again.status).toBe(409);
  });

  it("records nothing once declined, and refuses days already gone or the wrong way round", async () => {
    const [request0] = (await (await ask({ from: "2026-10-05", to: "2026-10-05" })).json<Asks>()).requests;
    expect(
      (await job.opsPost(`/api/leave-requests/${request0?.id ?? ""}/decision`, { decision: "declined" })).status,
    ).toBe(204);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM technician_leave").first<{ n: number }>())?.n).toBe(0);
    expect((await (await job.get("/api/tech/leave")).json<Asks>()).requests[0]?.state).toBe("declined");

    expect((await ask({ from: "2026-09-20", to: "2026-09-22" })).status).toBe(400);
    expect((await ask({ from: "2026-09-30", to: "2026-09-29" })).status).toBe(400);
  });
});
