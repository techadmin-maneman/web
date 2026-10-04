// FLD-63, UX-03: a refused step opens again with what it sent, not blank, so nothing is typed twice at the door
// (apps/tech/src/steps/sent-before.ts).

import { describe, expect, it } from "vitest";
import { checklistSent, outcomeSent, pieceSent } from "../../../apps/tech/src/steps/sent-before.ts";
import type { Queued } from "../../../apps/tech/src/store/outbox.ts";

const refused = (kind: Queued["kind"], body: unknown): Queued => ({
  seq: 1,
  id: "e",
  job_id: "a",
  kind,
  path: "",
  body,
  queued_at: 0,
  state: "refused",
  note: "invalid_request",
  fields: [],
});

describe("a refused checklist", () => {
  it("starts with the items it ticked that the card still lists", () => {
    const sent = refused("checklist", { done: ["scalp", "gone", "fit", 7] });
    expect(checklistSent(sent, ["scalp", "fit", "clean"])).toEqual(["scalp", "fit"]);
  });

  it("starts unticked with nothing refused, or a body of another shape", () => {
    expect(checklistSent(null, ["scalp"])).toEqual([]);
    expect(checklistSent(refused("checklist", { done: "scalp" }), ["scalp"])).toEqual([]);
  });
});

describe("a refused piece", () => {
  it("starts with the label, base, lot and the piece that came off", () => {
    const sent = refused("piece", {
      piece_code: "MM-STD-7193 C",
      base: "Lace",
      supplier_lot: "LOT-5120",
      old_piece: { piece_code: "MM-STD-4417-B", failure_reason: "Lifted at the front" },
    });
    expect(pieceSent(sent)).toEqual({
      declined: false,
      product: null,
      code: "MM-STD-7193 C",
      base: "Lace",
      lot: "LOT-5120",
      oldCode: "MM-STD-4417-B",
      oldReason: "Lifted at the front",
    });
  });

  it("keeps a one visit's product, or that the client decided against the fit", () => {
    expect(pieceSent(refused("piece", { piece_code: "MM-STD-7193-C", product: "premium" }))).toMatchObject({
      declined: false,
      product: "premium",
    });
    expect(pieceSent(refused("piece", { declined: true }))).toMatchObject({ declined: true, code: "" });
  });

  it("is nothing to start from with no refused step", () => {
    expect(pieceSent(null)).toBeNull();
  });
});

describe("a refused outcome", () => {
  it("starts as Done, or as Partial with its reason while the card still offers it", () => {
    expect(outcomeSent(refused("outcome", { outcome: "done" }), [])).toEqual({ choice: "done", reason: null });
    const partial = refused("outcome", { outcome: "partial", reason: "client_stopped_it" });
    expect(outcomeSent(partial, ["client_stopped_it"])).toEqual({ choice: "partial", reason: "client_stopped_it" });
    expect(outcomeSent(partial, ["piece_not_ready"])).toEqual({ choice: "partial", reason: null });
  });

  it("starts with nothing chosen for a body it cannot read", () => {
    expect(outcomeSent(null, [])).toBeNull();
    expect(outcomeSent(refused("outcome", { outcome: "no_show" }), [])).toBeNull();
  });
});
