// The consumables, each service's expected use, the job sheet, and the stock
// (docs/decisions/0087-consumables-and-stock.md). No board draws them, so the
// figures are made up to show each state once: a consumable offered, one
// retiring and one retired; a kit low on one consumable, and a store below
// nothing on another.

import type { OpsReply } from "../answer.ts";

export const IMRAN = "33333333-3333-4333-8333-333333333331";
export const SAMEER = "33333333-3333-4333-8333-333333333332";

export const CONSUMABLES = {
  consumables: [
    {
      code: "bonding_glue",
      name: "Bonding glue",
      unit: "ml",
      unit_cost: 90,
      reorder_kit: 20,
      reorder_central: 200,
      retired_from: null,
      offered: true,
    },
    {
      code: "shampoo_sachet",
      name: "Shampoo sachet",
      unit: "sachet",
      unit_cost: 800,
      reorder_kit: null,
      reorder_central: null,
      retired_from: "2027-09-01",
      offered: false,
    },
    {
      code: "solvent",
      name: "Solvent",
      unit: "ml",
      unit_cost: 50,
      reorder_kit: 50,
      reorder_central: null,
      retired_from: "2027-10-01",
      offered: true,
    },
    {
      code: "tape_strips",
      name: "Tape strips",
      unit: "strip",
      unit_cost: 1250,
      reorder_kit: 5,
      reorder_central: 50,
      retired_from: null,
      offered: true,
    },
  ],
  // The services the console holds, by name, in its order (docs/decisions/0085-services-ops-can-edit.md): a premium
  // first fit retired from October, which a fit sold before it still reads.
  services: [
    { visit_type: "consultation", tier: "standard", name: "Consultation", retired_date: null, expected: [] },
    {
      visit_type: "first_fit",
      tier: "standard",
      name: "First fit",
      retired_date: null,
      expected: [{ code: "tape_strips", quantity: 8 }],
    },
    {
      visit_type: "first_fit",
      tier: "premium",
      name: "Premium first fit",
      retired_date: "2027-10-01",
      expected: [{ code: "tape_strips", quantity: 10 }],
    },
    {
      visit_type: "service",
      tier: "standard",
      name: "Service visit",
      retired_date: null,
      expected: [
        { code: "solvent", quantity: 10 },
        { code: "tape_strips", quantity: 4 },
      ],
    },
    { visit_type: "replacement", tier: "standard", name: "Replacement", retired_date: null, expected: [] },
  ],
  today: "2027-09-21",
  max_unit_cost: 10_000_000,
  max_expected: 999,
  max_reorder_level: 100_000,
} satisfies OpsReply<"/api/consumables">;

const list = (items: [string, string][], retired: [string, string][] = [], setBy: string | null = null) => ({
  items: items.map(([code, label]) => ({ code, label })),
  retired: retired.map(([code, label]) => ({ code, label })),
  set_by: setBy,
  set_at: setBy === null ? null : "2027-09-20T06:00:00.000Z",
});

/** The service visit's checklist as ops set it, one item taken off; the other kinds' and the reasons committed. */
export const JOB_SHEET = {
  checklists: [
    { visit_type: "consultation", ...list([["scalp_checked", "Scalp and hairline checked"]]) },
    { visit_type: "first_fit", ...list([["template_checked", "Template checked against the head"]]) },
    {
      visit_type: "service",
      ...list(
        [
          ["piece_removed", "Piece removed"],
          ["scalp_cleaned", "Scalp cleaned"],
          ["piece_refitted", "Piece refitted"],
        ],
        [["adhesive_renewed", "Adhesive renewed"]],
        "ops@maneman.in",
      ),
    },
    { visit_type: "replacement", ...list([["old_piece_removed", "Old piece removed"]]) },
  ],
  partial_reasons: list([
    ["client_stopped_it", "Client stopped it partway"],
    ["piece_not_ready", "The piece was not ready"],
  ]),
  max_checklist_items: 20,
  max_partial_reasons: 12,
  max_label: 80,
} satisfies OpsReply<"/api/job-sheet">;

const holding = (
  code: string,
  place: string | null,
  quantity: number,
  low = false,
  countedAt: string | null = null,
) => ({
  consumable_code: code,
  technician_id: place,
  quantity,
  low,
  counted_at: countedAt,
});

export const STOCK = {
  consumables: [
    { code: "solvent", name: "Solvent", unit: "ml", retired: false, reorder_kit: 50, reorder_central: null },
    { code: "tape_strips", name: "Tape strips", unit: "strip", retired: false, reorder_kit: 5, reorder_central: 50 },
  ],
  places: [
    { technician_id: null, name: null, active: true },
    { technician_id: IMRAN, name: "Imran Qureshi", active: true },
    { technician_id: SAMEER, name: "Sameer Bhatt", active: false },
  ],
  holdings: [
    holding("solvent", null, -20),
    holding("solvent", IMRAN, 150),
    holding("solvent", SAMEER, 0),
    holding("tape_strips", null, 120, false, "2027-09-20T06:00:00.000Z"),
    holding("tape_strips", IMRAN, 3, true),
    holding("tape_strips", SAMEER, 6),
  ],
  movements: [
    {
      at: "2027-09-21T05:10:00.000Z",
      consumable_code: "tape_strips",
      technician_id: IMRAN,
      quantity: -4,
      reason: "used",
      by: IMRAN,
      note: null,
    },
    {
      at: "2027-09-20T06:00:00.000Z",
      consumable_code: "tape_strips",
      technician_id: null,
      quantity: 100,
      reason: "received",
      by: "ops@maneman.in",
      note: "Supplier's note 4417",
    },
  ],
  today: "2027-09-21",
  max_quantity: 100_000,
} satisfies OpsReply<"/api/stock">;
