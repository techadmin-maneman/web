// The dispatch board's clash check and move reasons, each rule named by the
// prompt's own words (src/policy/dispatch.ts).

import { describe, expect, it } from "vitest";
import { SLOTS_PER_DAY, UNITS_PER_DAY, VISIT_BLOCKS, type BookingWindow } from "../../src/config/scheduling.ts";
import { clashes, clientNotice, MOVE_REASONS, moveRefusal, RULES, slotsFor } from "../../src/policy/dispatch.ts";

/** A technician whose day already holds a job starting in each of these windows. */
const day = (...windows: BookingWindow[]) => ({ windows: new Set(windows), onLeave: false });
/** The same technician, away that day (ADR 0062). */
const away = (...windows: BookingWindow[]) => ({ ...day(...windows), onLeave: true });
/** Whether the visit's block has room in the window, as src/domain/scheduling.ts answers it. */
const FITS = { fits: true };
const NO_ROOM = { fits: false };

describe("dispatch", () => {
  it(RULES[0], () => {
    expect(SLOTS_PER_DAY).toBe(4);
    expect(UNITS_PER_DAY).toBe(8); // counted in halves, so a replacement's block is whole
  });

  it(RULES[1], () => {
    expect(slotsFor("consultation")).toBe(1);
    expect(slotsFor("service")).toBe(1);
    expect(slotsFor("replacement")).toBe(1.5);
    expect(slotsFor("first_fit")).toBe(2);
  });

  it("books each visit for the length the owner ruled on 24 September 2026", () => {
    // What FSM holds the appointment for, and what a technician's day is
    // measured against (docs/open-points.md, "Visit lengths").
    expect(VISIT_BLOCKS.consultation.minutes).toBe(60);
    expect(VISIT_BLOCKS.service.minutes).toBe(90);
    expect(VISIT_BLOCKS.replacement.minutes).toBe(135);
    expect(VISIT_BLOCKS.first_fit.minutes).toBe(180);
  });

  it(RULES[2], () => {
    expect(clashes(day("afternoon"), "afternoon")).toBe(true);
    expect(clashes(day("afternoon"), "morning")).toBe(false);
    expect(clashes(day(), "afternoon")).toBe(false);
    // Two jobs on one date is fine, as long as they are in different windows.
    expect(clashes(day("morning", "evening"), "afternoon")).toBe(false);
  });

  // RULES[3] ends "messages the client with the new window". A WhatsApp message
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

  it(RULES[3], () => {
    expect([...MOVE_REASONS]).toEqual([
      "technician_unavailable",
      "client_asked",
      "zone_rebalance",
      "skill_needed",
      "running_over",
    ]);
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
});
