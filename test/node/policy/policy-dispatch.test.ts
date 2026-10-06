// The dispatch board's clash check and move reasons (src/policy/dispatch.ts).

import { describe, expect, it } from "vitest";
import { SLOTS_PER_DAY, UNITS_PER_DAY, VISIT_BLOCKS, type BookingWindow } from "../../../src/config/scheduling.ts";
import {
  clashes,
  clientNotice,
  keepsTheClientsNotice,
  MOVE_REASONS,
  moveRefusal,
  slotsFor,
  targetTime,
} from "../../../src/policy/dispatch.ts";
import { unitsFor } from "../../../src/policy/visit-length.ts";

/** A technician whose day already holds a job starting in each of these windows. */
const day = (...windows: BookingWindow[]) => ({ windows: new Set(windows), onLeave: false });
/** The same technician, away that day (ADR 0062). */
const away = (...windows: BookingWindow[]) => ({ ...day(...windows), onLeave: true });
/** Whether the visit's block has room in the window, as src/domain/occupancy.ts answers it, on a day ahead. */
const FITS = { time: "ahead", fits: true, blackoutWithoutReason: false, besideTheClient: false } as const;
const NO_ROOM = { ...FITS, fits: false };

describe("dispatch", () => {
  it("divides each day into 4 slots, counted as 8 half-slots", () => {
    expect(SLOTS_PER_DAY).toBe(4);
    expect(UNITS_PER_DAY).toBe(8); // counted in halves, so a replacement's block is whole
  });

  // Each block's size comes from its service's length (src/policy/visit-length.ts), and the kinds' own lengths
  // give the prompt's four (docs/decisions/0085-services-ops-can-edit.md).
  it("sizes each kind's block in slots: consultation 1, service 1, replacement 1.5, first fit 2", () => {
    const sized = (type: keyof typeof VISIT_BLOCKS) => slotsFor(unitsFor(VISIT_BLOCKS[type].minutes));
    expect(sized("consultation")).toBe(1);
    expect(sized("service")).toBe(1);
    expect(sized("replacement")).toBe(1.5);
    expect(sized("first_fit")).toBe(2);
  });

  it("books each visit for its kind's length", () => {
    // What FSM holds the appointment for, and what a technician's day is
    // measured against (docs/open-points.md, "Visit lengths").
    expect(VISIT_BLOCKS.consultation.minutes).toBe(60);
    expect(VISIT_BLOCKS.service.minutes).toBe(90);
    expect(VISIT_BLOCKS.replacement.minutes).toBe(135);
    expect(VISIT_BLOCKS.first_fit.minutes).toBe(180);
  });

  it("never gives a technician two live jobs in one window on one date", () => {
    expect(clashes(day("afternoon"), "afternoon")).toBe(true);
    expect(clashes(day("afternoon"), "morning")).toBe(false);
    expect(clashes(day(), "afternoon")).toBe(false);
    // Two jobs on one date is fine, as long as they are in different windows.
    expect(clashes(day("morning", "evening"), "afternoon")).toBe(false);
  });

  // A move tells the client of its new window. A WhatsApp message
  // about a visit goes only to a client who agreed to them (whatsapp_visits), so
  // any other is told by a call from ops, and a change of technician alone
  // leaves the window, and the client, as they were (ADR 0069).
  it("tells the client of a new day or window: on WhatsApp if he agreed to it, by a call from ops if not", () => {
    expect(clientNotice({ timeChanged: true, client: { agreedToWhatsApp: true } })).toBe("messaged");
    expect(clientNotice({ timeChanged: true, client: { agreedToWhatsApp: false } })).toBe("call");
    expect(clientNotice({ timeChanged: false, client: { agreedToWhatsApp: false } })).toBe("unchanged");
    expect(clientNotice({ timeChanged: false, client: { agreedToWhatsApp: true } })).toBe("unchanged");
    expect(clientNotice({ timeChanged: true, client: null })).toBe("no_client");
  });

  it("takes a move's reason from the design's five, in its order", () => {
    expect([...MOVE_REASONS]).toEqual([
      "technician_unavailable",
      "client_asked",
      "zone_rebalance",
      "skill_needed",
      "running_over",
    ]);
  });

  // A client keeps the free change after a move by ops. A move the client asked for is at a time they chose, as a move in the app is.
  it("leaves the client counting from the time before a move ops make, unless the client asked for it", () => {
    expect(MOVE_REASONS.filter((reason) => !keepsTheClientsNotice(reason))).toEqual(["client_asked"]);
  });

  it("refuses a move that clashes, and lets one through that does not", () => {
    expect(moveRefusal(day(), "morning", FITS)).toBeNull();
    expect(moveRefusal(day("morning"), "morning", FITS)).toBe("clash");
  });

  // The rule the prompt's last line asks for, kept our way (ADR 0062): the day
  // is refused outright, and named as leave so ops are not told it is merely full.
  it("refuses every window of a day the technician is away, and says it is leave", () => {
    expect(moveRefusal(away(), "morning", FITS)).toBe("on_leave");
    expect(moveRefusal(away(), "afternoon", FITS)).toBe("on_leave");
    expect(moveRefusal(away(), "evening", FITS)).toBe("on_leave");
    // An empty window on a day off is still leave, not a clash.
    expect(moveRefusal(away("evening"), "morning", FITS)).toBe("on_leave");
  });

  // "A visit fits where every half-slot of its block is free" (ADR 0034), and "a
  // visit may run on past its window's end, but not past the day's last
  // half-slot, so a first fit cannot start in the evening" (ADR 0035). A window
  // nobody holds can still have no room, and ops are told that, not that it clashes.
  it("refuses a job with no room in a free window as not fitting, not as a clash", () => {
    expect(moveRefusal(day(), "evening", NO_ROOM)).toBe("does_not_fit");
    expect(moveRefusal(day(), "evening", FITS)).toBeNull();
    // A window someone holds is still a clash, and a day off still leave, whatever the room.
    expect(moveRefusal(day("evening"), "evening", NO_ROOM)).toBe("clash");
    expect(moveRefusal(away(), "evening", NO_ROOM)).toBe("on_leave");
  });

  // At 09:58 four visits moved to that morning all landed at 09:00, and a move to yesterday went through.
  it("reads a day gone, and today's window once every start in it has passed, as no longer ahead", () => {
    // At 12:00 the afternoon's first start (half-slot 2) is under way and its next (3) is still to come.
    const noon = { date: "2026-10-02", firstUnitAhead: 3 };
    expect(targetTime({ date: "2026-10-01", window: "evening" }, noon)).toBe("past_day");
    expect(targetTime({ date: "2026-10-02", window: "morning" }, noon)).toBe("window_passed");
    expect(targetTime({ date: "2026-10-02", window: "afternoon" }, noon)).toBe("ahead");
    expect(targetTime({ date: "2026-10-03", window: "morning" }, noon)).toBe("ahead");
    // After the day's last start, every window of today has passed.
    expect(targetTime({ date: "2026-10-02", window: "evening" }, { ...noon, firstUnitAhead: UNITS_PER_DAY })).toBe(
      "window_passed",
    );
  });

  it("refuses a time already gone before anything else, whatever the technician's day holds", () => {
    expect(moveRefusal(away("morning"), "morning", { ...NO_ROOM, time: "past_day" })).toBe("past_day");
    expect(moveRefusal(day("morning"), "morning", { ...NO_ROOM, time: "window_passed" })).toBe("window_passed");
  });

  // A technician never takes two of a client's visits in a row (docs/decisions/0111).
  it("refuses the technician beside the client's visit after leave, and before a clash or a day with no room", () => {
    const beside = { ...FITS, besideTheClient: true };
    expect(moveRefusal(day(), "morning", beside)).toBe("back_to_back");
    expect(moveRefusal(day("morning"), "morning", beside)).toBe("back_to_back");
    expect(moveRefusal(away(), "morning", beside)).toBe("on_leave");
    expect(moveRefusal(day(), "morning", { ...beside, time: "past_day" })).toBe("past_day");
  });

  // Owner decision 16: a move onto a blacked-out day goes ahead with a warning and a typed reason.
  it("refuses a blacked-out day only while no reason was given, and only once nothing else stands in the way", () => {
    expect(moveRefusal(day(), "morning", { ...FITS, blackoutWithoutReason: true })).toBe("blackout");
    expect(moveRefusal(day(), "morning", FITS)).toBeNull();
    expect(moveRefusal(day("morning"), "morning", { ...FITS, blackoutWithoutReason: true })).toBe("clash");
    expect(moveRefusal(day(), "evening", { ...NO_ROOM, blackoutWithoutReason: true })).toBe("does_not_fit");
  });
});
