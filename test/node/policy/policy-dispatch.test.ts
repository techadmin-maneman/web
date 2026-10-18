// The dispatch board's blocks and move reasons (src/policy/dispatch.ts).

import { describe, expect, it } from "vitest";
import { SLOTS_PER_DAY, UNITS_PER_DAY, VISIT_BLOCKS } from "../../../src/config/scheduling.ts";
import { clientNotice, keepsTheClientsNotice, MOVE_REASONS, slotsFor } from "../../../src/policy/dispatch.ts";
import { unitsFor } from "../../../src/policy/visit-length.ts";

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

  // A move tells the client of its new window. A WhatsApp message
  // about a visit goes only to a client who agreed to them (whatsapp_visits), so
  // any other is told by a call from ops, and a change of technician alone
  // leaves the window, and the client, as they were (ADR 0069).
  it("tells the client of a new day or window: on WhatsApp if they agreed to it, by a call from ops if not", () => {
    expect(clientNotice({ timeChanged: true, client: { agreedToWhatsApp: true } })).toBe("messaged");
    expect(clientNotice({ timeChanged: true, client: { agreedToWhatsApp: false } })).toBe("call");
    expect(clientNotice({ timeChanged: false, client: { agreedToWhatsApp: false } })).toBe("unchanged");
    expect(clientNotice({ timeChanged: false, client: { agreedToWhatsApp: true } })).toBe("unchanged");
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
});
