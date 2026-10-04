// The job sheet ops set in the console, and the technician app reads with the job
// (src/routes/ops-job-sheet.ts, docs/decisions/0087-consumables-and-stock.md;
// docs/open-points.md, item 28). NOW is Monday 21 September 2026, 12 noon in India.
//
// What these hold: until ops save a list the committed one stands; a saved
// list keeps each item's code through a rename and retires what it leaves
// out; a phone that queued a retired item offline is still understood; and
// the card, the steps, FSM's summary and the Tasks board all read the words
// ops gave.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { CHECKLIST, PARTIAL_REASONS } from "../../src/config/job-sheet.ts";
import { markDatabase, request } from "./helpers.ts";
import { JOB, PERSON, working, type Working } from "./job-fixtures.ts";

interface List {
  items: { code: string; label: string }[];
  retired: { code: string; label: string }[];
  set_by: string | null;
  set_at: string | null;
}

interface Sheet {
  checklists: (List & { visit_type: string })[];
  partial_reasons: List;
}

let job: Working;

const sheet = async (): Promise<Sheet> => (await request(job.ops, "/api/job-sheet")).json<Sheet>();
const serviceList = (answer: Sheet) => answer.checklists.find((list) => list.visit_type === "service");

/** The service visit's committed six, with the second renamed, the fourth taken off and one added. */
const EDITED = [
  { code: "piece_removed", label: "Piece removed" },
  { code: "scalp_cleaned", label: "Scalp cleaned and dried" },
  { code: "piece_cleaned", label: "Piece cleaned" },
  { code: "piece_refitted", label: "Piece refitted" },
  { code: "cut_and_styled", label: "Cut and styled" },
  { label: "Photo angles checked" },
];

beforeEach(async () => {
  await markDatabase();
  job = await working();
});

describe("before ops save a list", () => {
  it("answers the committed lists, and says nobody set them", async () => {
    const answer = await sheet();

    expect(serviceList(answer)).toEqual({
      visit_type: "service",
      items: CHECKLIST.service.map((item) => ({ code: item.id, label: item.label })),
      retired: [],
      set_by: null,
      set_at: null,
    });
    expect(answer.partial_reasons.items.map((item) => item.code)).toEqual(PARTIAL_REASONS.map((reason) => reason.id));
  });

  it("gives the technician's card the committed checklist and reasons, words and all", async () => {
    const card = await (await job.get(`/api/tech/jobs/${JOB}`)).json<Record<string, unknown>>();
    expect(card.checklist).toEqual(CHECKLIST.service);
    expect(card.partial_reasons).toEqual(PARTIAL_REASONS);
  });
});

describe("a checklist ops save", () => {
  it("keeps each code through a rename, makes a code for a new item, and retires the one left out", async () => {
    const answer = await job.opsPost("/api/job-sheet/checklists/service", { items: EDITED });

    expect(answer.status).toBe(200);
    const list = serviceList(await answer.json<Sheet>());
    expect(list?.items).toEqual([
      { code: "piece_removed", label: "Piece removed" },
      { code: "scalp_cleaned", label: "Scalp cleaned and dried" },
      { code: "piece_cleaned", label: "Piece cleaned" },
      { code: "piece_refitted", label: "Piece refitted" },
      { code: "cut_and_styled", label: "Cut and styled" },
      { code: "photo_angles_checked", label: "Photo angles checked" },
    ]);
    expect(list?.retired).toEqual([{ code: "adhesive_renewed", label: "PLACEHOLDER Adhesive renewed" }]);
    expect(list?.set_by).toBe("ops@localhost");

    const audit = await env.DB.prepare(
      "SELECT subject_id, detail FROM audit_log WHERE action = 'job_sheet.set'",
    ).first<{
      subject_id: string;
      detail: string;
    }>();
    expect(audit?.subject_id).toBe("checklist/service");
    expect(JSON.parse(audit?.detail ?? "{}")).toEqual({ items: 6, added: 1, renamed: 5, retired: 1 });
  });

  it("brings back an item it retired when it is sent again, and leaves the other kinds' lists alone", async () => {
    await job.opsPost("/api/job-sheet/checklists/service", { items: EDITED });
    await job.opsPost("/api/job-sheet/checklists/service", {
      items: [...EDITED.slice(0, 5), { code: "adhesive_renewed", label: "Adhesive renewed" }],
    });

    const answer = await sheet();
    const list = serviceList(answer);
    expect(list?.items.map((item) => item.code)).toContain("adhesive_renewed");
    expect(list?.retired).toEqual([{ code: "photo_angles_checked", label: "Photo angles checked" }]);
    expect(answer.checklists.find((each) => each.visit_type === "replacement")?.set_by).toBeNull();
  });

  it.each([
    ["an empty list, which no technician could finish", { items: [] }, "items"],
    ["a list past twenty", { items: Array.from({ length: 21 }, (_, n) => ({ label: `Step ${String(n)}` })) }, "items"],
    [
      "two items of the same words",
      { items: [{ label: "Piece removed" }, { label: "piece removed" }] },
      "items.1.label",
    ],
    ["a code the list never held", { items: [{ code: "made_up", label: "Made up" }] }, "items.0.code"],
    ["a label of nothing but spaces", { items: [{ label: "   " }] }, "items.0.label"],
  ])("refuses %s, and changes nothing", async (_, body, field) => {
    const answer = await job.opsPost("/api/job-sheet/checklists/service", body);

    expect(answer.status).toBe(400);
    expect((await answer.json<{ error: { fields: string[] } }>()).error.fields).toContain(field);
    expect(serviceList(await sheet())?.set_by).toBeNull();
  });

  it("reaches the technician's card, and a phone that ticked a retired item offline is still taken", async () => {
    await job.opsPost("/api/job-sheet/checklists/service", { items: EDITED });

    const card = await (await job.get(`/api/tech/jobs/${JOB}`)).json<{ checklist: { id: string }[] }>();
    expect(card.checklist.map((item) => item.id)).toEqual([
      "piece_removed",
      "scalp_cleaned",
      "piece_cleaned",
      "piece_refitted",
      "cut_and_styled",
      "photo_angles_checked",
    ]);

    await job.workTo("checklist");
    const ticked = await job.post(
      `/api/tech/jobs/${JOB}/checklist`,
      { done: ["piece_removed", "adhesive_renewed", "photo_angles_checked"] },
      "event-checklist-01",
    );
    expect(ticked.status).toBe(202);
  });

  it("refuses a code no list of the kind ever held", async () => {
    await job.workTo("checklist");
    const answer = await job.post(`/api/tech/jobs/${JOB}/checklist`, { done: ["made_up"] }, "event-checklist-01");

    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({ error: { code: "invalid_request", fields: ["done"] } });
  });
});

describe("the partial reasons ops save", () => {
  const REASONS = [
    { code: "client_stopped_it", label: "Client stopped it partway" },
    { code: "piece_not_ready", label: "The piece was not ready" },
    { label: "Power cut" },
  ];

  it("reach the card in their order, and a new one closes a job partial", async () => {
    const saved = await job.opsPost("/api/job-sheet/partial-reasons", { items: REASONS });
    expect((await saved.json<Sheet>()).partial_reasons.retired.map((reason) => reason.code)).toEqual([
      "client_unwell",
      "more_time_needed",
    ]);

    const card = await (await job.get(`/api/tech/jobs/${JOB}`)).json<{ partial_reasons: unknown }>();
    expect(card.partial_reasons).toEqual([
      { id: "client_stopped_it", label: "Client stopped it partway" },
      { id: "piece_not_ready", label: "The piece was not ready" },
      { id: "power_cut", label: "Power cut" },
    ]);

    await job.workTo("outcome");
    const closed = await job.post(
      `/api/tech/jobs/${JOB}/outcome`,
      { outcome: "partial", reason: "power_cut" },
      "event-outcome-01",
    );
    expect(closed.status).toBe(202);
  });

  it("still take a reason ops have retired, which a phone may have queued offline, and refuse one never listed", async () => {
    await job.opsPost("/api/job-sheet/partial-reasons", { items: REASONS });
    await job.workTo("outcome");

    const unknown = await job.post(
      `/api/tech/jobs/${JOB}/outcome`,
      { outcome: "partial", reason: "stars_misaligned" },
      "event-outcome-01",
    );
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({ error: { fields: ["reason"] } });

    const retired = await job.post(
      `/api/tech/jobs/${JOB}/outcome`,
      { outcome: "partial", reason: "client_unwell" },
      "event-outcome-02",
    );
    expect(retired.status).toBe(202);
  });

  it("refuse a list past twelve", async () => {
    const answer = await job.opsPost("/api/job-sheet/partial-reasons", {
      items: Array.from({ length: 13 }, (_, n) => ({ label: `Reason ${String(n)}` })),
    });
    expect(answer.status).toBe(400);
  });

  it("name a partial visit's task on the Tasks board in ops' words", async () => {
    const closed = async (reason: string) => {
      await env.DB.batch([
        env.DB.prepare("UPDATE appointments SET status = 'terminated', fsm_status = 'Terminated' WHERE id = ?1").bind(
          JOB,
        ),
        env.DB.prepare(
          `INSERT INTO visits (id, appointment_id, ended_at, outcome, partial_reason, updated_at)
           VALUES ('visit-1', ?1, '2026-09-21T08:40:00.000Z', 'partial', ?2, '2026-09-21T08:40:00.000Z')
           ON CONFLICT (appointment_id) DO UPDATE SET partial_reason = excluded.partial_reason`,
        ).bind(JOB, reason),
      ]);
    };
    const partialTask = async () => {
      const board = await (
        await request(job.ops, "/api/tasks")
      ).json<{
        groups: { group: string; tasks: { person: { id: string } | null; detail: string | null }[] }[];
      }>();
      return board.groups.find((group) => group.group === "partial_visit")?.tasks[0];
    };

    // Until ops save the reasons, the committed words.
    await closed("piece_not_ready");
    expect(await partialTask()).toMatchObject({
      person: { id: PERSON },
      detail: "PLACEHOLDER The piece was not ready",
    });

    await job.opsPost("/api/job-sheet/partial-reasons", { items: REASONS });
    expect((await partialTask())?.detail).toBe("The piece was not ready");
    await closed("client_unwell");
    expect((await partialTask())?.detail).toBe("PLACEHOLDER Client unwell");
  });
});
