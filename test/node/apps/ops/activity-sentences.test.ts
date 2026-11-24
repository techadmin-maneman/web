// Activity's sentences (apps/ops/src/activity/sentence.ts): every change the console can make reads as what was done,
// with the client or visit it touched named where its words leave the place, and the file says the same.

import { ROUTE_NEEDS } from "@rules/policy/console-routes.ts";
import { describe, expect, it } from "vitest";
import { csvRows, sentenceOf, sentenceText } from "../../../../apps/ops/src/activity/sentence.ts";
import type { components } from "../../../../apps/ops/src/api-schema.ts";
import { activity } from "../../../../apps/ops/src/content/activity.ts";
import { CONSOLE_CALLS, DONE } from "../../../../apps/ops/src/content/activity-sentences.ts";

type Entry = components["schemas"]["ActivityEntry"];

/** A call under a client's or a visit's address: the log names the record it opens (src/http/audit.ts). */
const NAMES_A_RECORD = /^[A-Z]+ \/api\/(clients|visits)\/\{id\}\//;

const entry = (over: Partial<Entry>): Entry => ({
  id: 1,
  at: "2026-11-24T05:44:00.000Z",
  surface: "ops",
  actor: { kind: "staff", id: "ops.lead@maneman.in", name: null },
  action: "ops.call",
  subject: null,
  detail: null,
  ...over,
});

describe("Activity's words for the console's calls", () => {
  const writes = Object.keys(ROUTE_NEEDS).filter((call) => !call.startsWith("GET "));

  it("says what each change the console can make was", () => {
    for (const call of writes) expect(CONSOLE_CALLS[call], call).toBeTruthy();
  });

  it("leaves the record's place in the words exactly where the log names a record", () => {
    for (const call of writes) expect(CONSOLE_CALLS[call]?.includes("{name}"), call).toBe(NAMES_A_RECORD.test(call));
  });

  it("leaves no more than one place for a name in any sentence", () => {
    for (const said of [...Object.values(CONSOLE_CALLS), ...Object.values(DONE)]) {
      expect(said.split("{name}").length, said).toBeLessThanOrEqual(2);
    }
  });
});

describe("an entry as a sentence", () => {
  it("names the visit's client where a console call to a visit leaves the place", () => {
    const said = sentenceOf(
      entry({
        subject: { kind: "appointment", id: "a-1", label: "Neha Kapoor" },
        detail: { method: "POST", route: "/api/visits/:id/cancel", path: "/api/visits/a-1/cancel" },
      }),
    );
    expect(sentenceText(said)).toBe("ops.lead@maneman.in cancelled a visit for Neha Kapoor");
    expect(said.named?.opens).toEqual({ kind: "visit", id: "a-1" });
  });

  it("names a technician's visit by its client, and the technician by their own page", () => {
    const said = sentenceOf(
      entry({
        surface: "tech",
        actor: { kind: "technician", id: "t-1", name: "Sandeep Yadav" },
        action: "tech.call",
        subject: { kind: "appointment", id: "a-1", label: "Neha Kapoor" },
        detail: { method: "POST", route: "/api/tech/jobs/:id/outcome", path: "/api/tech/jobs/a-1/outcome" },
      }),
    );
    expect(sentenceText(said)).toBe("Sandeep Yadav closed the visit for Neha Kapoor");
    expect(said.who.opens).toEqual({ kind: "technician", id: "t-1" });
  });

  it("never names a client's own record after their name", () => {
    const said = sentenceOf(
      entry({
        surface: "client",
        actor: { kind: "client", id: "p-1", name: "Neha Kapoor" },
        action: "visit.move_accepted",
        subject: { kind: "appointment", id: "a-1", label: "Neha Kapoor" },
      }),
    );
    expect(sentenceText(said)).toBe("Neha Kapoor accepted a new day");
  });

  it("drops the place, and the word that led to it, where the record has no name to give", () => {
    const said = sentenceOf(
      entry({
        action: "visit.lost_reason",
        subject: { kind: "x", id: "0a1b2c3d-4e5f-4a1b-8c2d-1e2f3a4b5c6d", label: null },
      }),
    );
    expect(sentenceText(said)).toBe("ops.lead@maneman.in recorded why the visit did not go ahead");
  });

  it("calls an erased client a client, and still links their record", () => {
    const said = sentenceOf(entry({ action: "person.erase", subject: { kind: "person", id: "p-2", label: null } }));
    expect(sentenceText(said)).toBe(`ops.lead@maneman.in erased the record of ${activity.someClient}`);
    expect(said.named?.opens).toEqual({ kind: "client", id: "p-2" });
  });

  it("reads a page opened as that, on the record it opened", () => {
    const said = sentenceOf(
      entry({
        subject: { kind: "person", id: "p-1", label: "Neha Kapoor" },
        detail: { method: "GET", route: "/api/clients/:id", path: "/api/clients/p-1" },
      }),
    );
    expect(sentenceText(said)).toBe("ops.lead@maneman.in opened the record of Neha Kapoor");
  });

  it("marks a refused call as refused", () => {
    const refused = { method: "POST", route: "/api/spend", path: "/api/spend", refused: { status: "409" } };
    expect(sentenceOf(entry({ detail: refused })).refused).toBe(true);
  });
});

describe("the file Activity downloads", () => {
  it("writes a row an entry, its sentence beside the call and the record it touched", () => {
    const [head, row] = csvRows([
      entry({
        subject: { kind: "person", id: "p-1", label: "Neha Kapoor" },
        detail: { method: "POST", route: "/api/clients/:id/notes", path: "/api/clients/p-1/notes" },
      }),
    ]);
    expect(head).toHaveLength(row?.length ?? 0);
    expect(row).toEqual([
      "2026-11-24 11:14",
      "ops.lead@maneman.in",
      activity.filters.kinds.staff,
      activity.surfaces.ops,
      "ops.lead@maneman.in wrote a note on Neha Kapoor",
      activity.actions["ops.call"],
      "POST /api/clients/{id}/notes",
      activity.kinds.person ?? "person",
      "p-1",
      "",
    ]);
  });
});
