// A technician, as the booking and dispatch tests start from one: active, in Gurgaon, trained to fit. Every name is
// made up.

import { AT, writeRow, type RowOf } from "./rows.ts";

export const aTechnician = (row: RowOf<"technicians"> = {}) => {
  const id = row.id ?? crypto.randomUUID();
  return writeRow(
    "technicians",
    {
      id,
      fsm_id: id,
      name: "Imran Qureshi",
      initials: "IQ",
      active: 1,
      updated_at: AT,
      city: "Gurgaon",
      fits_trained: 1,
    },
    row,
  );
};
