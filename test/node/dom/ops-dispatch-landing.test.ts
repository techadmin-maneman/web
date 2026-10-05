// What the dispatch board says over itself after a move (apps/ops/src/dispatch/landing.ts), and what its search finds
// (apps/ops/src/dispatch/board-view.ts).

import { describe, expect, it } from "vitest";
import type { Block, Board, BoardRow } from "../../../apps/ops/src/api.ts";
import { answersTo, foundBy, weekOf } from "../../../apps/ops/src/dispatch/board-view.ts";
import type { BlockJob, Target } from "../../../apps/ops/src/dispatch/job.ts";
import { doneNotice, moveRefusal, staleWords } from "../../../apps/ops/src/dispatch/landing.ts";
import { dispatch } from "../../../apps/ops/src/content.ts";

const ROHIT = {
  id: "p1",
  name: "Rohit Malhotra",
  mobile: "+91 98100 00001",
  whatsapp_visits: false,
  referred_by: null,
};

const block = (overrides: Partial<Block> = {}): Block => ({
  appointment_id: "a1",
  type: "service",
  service: null,
  client: "Rohit M.",
  sector: "Sec 65",
  pincode: "122018",
  person: ROHIT,
  badge: "prepaid",
  slots: 1,
  client_note: null,
  starts_at: "2025-09-19T03:30:00.000Z",
  window: "morning",
  status: "scheduled",
  notice_hours: 24,
  untold: null,
  begun: null,
  ...overrides,
});

const row = (id: string, name: string, blocks: Block[]): BoardRow => ({
  technician_id: id,
  name,
  initials: name.slice(0, 1),
  zone: null,
  days: [{ date: "2025-09-19", blocks }],
});

const IMRAN = row("t1", "Imran Qureshi", [block()]);
const SALIM = row("t2", "Salim Khan", []);

const board = (technicians: BoardRow[]): Board => ({
  version: 1,
  from: "2025-09-19",
  dates: ["2025-09-19"],
  city: null,
  cities: [],
  technicians,
  unassigned: [],
  utilisation: [],
  leave: [],
});

const JOB: BlockJob = { kind: "block", block: block(), technician: IMRAN, date: "2025-09-19" };
const TO_SALIM: Target = { technician: SALIM, date: "2025-09-20", window: "evening" };

describe("what a move says once it is sent", () => {
  it("names the technician and the window a refused move asked for", () => {
    expect(moveRefusal(JOB, TO_SALIM, "clash")).toBe(dispatch.landing.clash("Salim Khan", "Sat 20 Sep", "evening"));
    expect(moveRefusal(JOB, TO_SALIM, "does_not_fit")).toContain(dispatch.typeNames.service ?? "service");
    expect(moveRefusal(JOB, TO_SALIM, "no_such_code")).toBe(dispatch.landing.errors.unknown);
  });

  it("asks ops to call a client WhatsApp may not message, and carries the move to record the call", () => {
    const notice = doneNotice(JOB, TO_SALIM, { move_id: "m1", client_notice: "call" });
    expect(notice.call).toEqual({ moveId: "m1", name: "Rohit Malhotra" });
    expect(doneNotice(JOB, TO_SALIM, { move_id: "m1", client_notice: "messaged" }).call).toBeNull();
  });

  it("says where a job moved by someone else now is, or that it is still being moved", () => {
    const elsewhere = board([row("t1", "Imran Qureshi", []), row("t2", "Salim Khan", [block({ window: "evening" })])]);
    expect(staleWords(JOB, "superseded", elsewhere)).toBe(
      dispatch.landing.superseded("Rohit M.", dispatch.landing.supersededWhere("Salim Khan", "Fri 19 Sep", "evening")),
    );
    expect(staleWords(JOB, "superseded", board([IMRAN]))).toBe(dispatch.landing.beingMoved("Rohit M."));
    expect(staleWords(JOB, "superseded", board([]))).toBe(
      dispatch.landing.superseded("Rohit M.", dispatch.landing.supersededGone),
    );
    expect(staleWords(JOB, "not_found", null)).toBe(dispatch.landing.errors.not_found);
  });
});

describe("the board's search", () => {
  it("keeps a technician's row by his name, and outlines no block for it", () => {
    expect(answersTo(SALIM, "salim")).toBe(true);
    expect(answersTo(IMRAN, "salim")).toBe(false);
    expect(foundBy(board([IMRAN, SALIM]), "salim")).toBeNull();
  });

  it("finds a visit by its client's full name or its pincode, and outlines it", () => {
    const found = foundBy(board([IMRAN, SALIM]), " malhotra ");
    expect(found?.(block())).toBe(true);
    expect(found?.(block({ client: "Aman S.", person: null }))).toBe(false);
    expect(answersTo(IMRAN, "122018")).toBe(true);
  });

  it("titles the week by its first and last days", () => {
    expect(weekOf([])).toBeUndefined();
    expect(weekOf(["2025-09-19", "2025-09-25"])).toBe(dispatch.week("19", "25 Sep"));
    expect(weekOf(["2025-09-28", "2025-10-04"])).toBe(dispatch.week("28 Sep", "4 Oct"));
  });
});
