// What the dispatch board reasons about a job in hand (apps/ops/src/dispatch/job.ts),
// and the days left that every queue counts (apps/ops/src/lib/due.ts). Neither had a
// test below the browser, where the board's fakes stood in (FEO-34).

import { describe, expect, it } from "vitest";
import type { Block, BoardRow, Unassigned } from "../../apps/ops/src/api.ts";
import {
  addDays,
  changesTime,
  firstNameOf,
  isMovable,
  nameOf,
  shownOf,
  whatsAppLink,
  whenOf,
  type BlockJob,
  type TrayJob,
} from "../../apps/ops/src/dispatch/job.ts";
import { daysUntil } from "../../apps/ops/src/lib/due.ts";

const ROHIT = {
  id: "p1",
  name: " Rohit  Malhotra",
  mobile: "+91 98100 00001",
  whatsapp_visits: true,
  referred_by: null,
};

const block = (overrides: Partial<Block> = {}): Block => ({
  appointment_id: "a1",
  type: "service",
  client: "Rohit M.",
  sector: "Sec 65",
  pincode: "122018",
  person: ROHIT,
  badge: "prepaid",
  slots: 1,
  starts_at: "2025-09-19T03:30:00.000Z",
  window: "morning",
  status: "scheduled",
  untold: null,
  ...overrides,
});

const ROW = { technician_id: "t1", name: "Imran Qureshi", initials: "IQ", zone: null, days: [] } satisfies BoardRow;

const onBoard = (overrides: Partial<Block> = {}): BlockJob => ({
  kind: "block",
  block: block(overrides),
  technician: ROW,
  date: "2025-09-19",
});

const inTray = (overrides: Partial<Unassigned> = {}): TrayJob => ({
  kind: "unassigned",
  job: {
    appointment_id: "a2",
    type: "first_fit",
    client: null,
    sector: "DLF 3",
    pincode: null,
    person: null,
    badge: "prepaid",
    slots: 2,
    starts_at: "2025-09-20T10:30:00.000Z",
    asked_window: "morning",
    offered_window: "evening",
    date: "2025-09-20",
    ...overrides,
  },
});

describe("a job's name on the board", () => {
  it("is the client on the block, else the kind of visit and where, else the board's word for nothing", () => {
    expect(nameOf(onBoard())).toBe("Rohit M.");
    expect(nameOf(inTray())).toBe("First fit · DLF 3");
    expect(nameOf(inTray({ type: null }))).toBe("DLF 3");
    expect(nameOf(inTray({ type: null, sector: null }))).not.toBe("");
  });

  it("gives the drawer the client's first name, and a WhatsApp chat with digits only", () => {
    expect(firstNameOf(ROHIT)).toBe("Rohit");
    expect(whatsAppLink(ROHIT.mobile)).toBe("https://wa.me/919810000001");
  });
});

describe("where a job stands, and what a move changes", () => {
  it("reads a block's day and window from the board, and a tray job's from the window it is offered", () => {
    expect(whenOf(onBoard())).toEqual({ date: "2025-09-19", window: "morning" });
    expect(whenOf(inTray())).toEqual({ date: "2025-09-20", window: "evening" });
  });

  it("sends what the board shows, so a stale board is refused, and no technician for a tray job", () => {
    expect(shownOf(onBoard())).toEqual({ technicianId: "t1", startsAt: "2025-09-19T03:30:00.000Z" });
    expect(shownOf(inTray())).toEqual({ technicianId: null, startsAt: "2025-09-20T10:30:00.000Z" });
  });

  it("changes the time only when the day or the window does, which is what the client is told of", () => {
    expect(changesTime(onBoard(), { technician: ROW, date: "2025-09-19", window: "morning" })).toBe(false);
    expect(changesTime(onBoard(), { technician: ROW, date: "2025-09-19", window: "evening" })).toBe(true);
    expect(changesTime(onBoard(), { technician: ROW, date: "2025-09-20", window: "morning" })).toBe(true);
  });

  it("moves anything not yet done, and nothing done", () => {
    expect(isMovable(block({ status: "in_progress" }))).toBe(true);
    expect(isMovable(block({ status: "completed" }))).toBe(false);
  });

  it("counts the board's weeks in whole days, across a month and a year's end", () => {
    expect(addDays("2025-09-29", 7)).toBe("2025-10-06");
    expect(addDays("2025-12-29", 7)).toBe("2026-01-05");
    expect(addDays("2025-10-06", -7)).toBe("2025-09-29");
  });
});

describe("the days something has left", () => {
  // 10:30 in India on 22 September 2027, as the board's tasks are read.
  const NOW = new Date("2027-09-22T05:00:00.000Z");

  it("counts India's days: due today is 0, tomorrow 1, and yesterday overdue by one", () => {
    expect(daysUntil("2027-09-22T12:00:00.000Z", NOW)).toBe(0);
    expect(daysUntil("2027-09-23T05:00:00.000Z", NOW)).toBe(1);
    expect(daysUntil("2027-09-21T05:00:00.000Z", NOW)).toBe(-1);
  });

  it("goes by India's midnight, not UTC's: 11 pm UTC on the 22nd is already the 23rd there", () => {
    expect(daysUntil("2027-09-22T23:00:00.000Z", NOW)).toBe(1);
    expect(daysUntil("2027-09-22T18:29:00.000Z", NOW)).toBe(0);
  });
});
