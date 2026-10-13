// A slot held for a client: a free service visit on Thursday 24 September's morning, held now and for the next
// fifteen minutes, unless the test says otherwise. Its client and technician are the test's to give.

import { AT, writeRow, type RowOf } from "./rows.ts";
import { NOW } from "../clock.ts";

type Hold = RowOf<"slot_holds"> & { readonly person_id: string; readonly technician_id: string };

export const aHold = (row: Hold) =>
  writeRow(
    "slot_holds",
    {
      id: crypto.randomUUID(),
      type: "service",
      date: "2026-09-24",
      window_label: "morning",
      start_unit: 0,
      amount: 0,
      amount_ex_gst: 0,
      gst_percent: 0,
      state: "held",
      pincode: "122018",
      expires_at: new Date(NOW.getTime() + 15 * 60_000).toISOString(),
      created_at: AT,
      updated_at: AT,
    },
    row,
  );
